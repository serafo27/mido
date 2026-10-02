//! Git for the repository the open folder is in (the folder itself or one
//! above it): status, history, diffs, staging, commits, push, pull and
//! resolving conflicts. Mido runs the user's own git, so their keys,
//! credential helpers, hooks and settings apply as they do in Terminal.
//!
//! A repository's settings can run programs (hooks, filters, an fsmonitor),
//! so nothing but finding the repository runs until the user trusts it in a
//! native prompt (`git_trust`). Commands only ever act when asked: Mido never
//! fetches, commits or pushes on its own.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::folders::Granted;
use crate::{err, write_atomic, writable_inside, Workspace};

/// Apps opened from the Finder don't get the shell's PATH, so look where git
/// usually is. On macOS `/usr/bin/git` is a stub that offers to install the
/// developer tools when they're missing, so it's only used when they're there.
pub fn binary() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        let found = ["/opt/homebrew/bin/git", "/usr/local/bin/git"]
            .into_iter()
            .map(PathBuf::from)
            .find(|p| p.is_file());
        if found.is_some() {
            return found;
        }
        let developer_dir = Command::new("/usr/bin/xcode-select").arg("-p").output().ok()?;
        let developer_dir = String::from_utf8(developer_dir.stdout).ok()?;
        let tools_git = Path::new(developer_dir.trim()).join("usr/bin/git");
        return tools_git.is_file().then(|| PathBuf::from("/usr/bin/git"));
    }
    Some(PathBuf::from("git"))
}

/// Files bigger than this aren't shown in a diff.
const MAX_DIFF_BYTES: usize = 5 * 1024 * 1024;

/// A repository and where the open folder sits in it.
#[derive(Debug, Clone)]
pub struct Repo {
    /// The working tree's top folder.
    pub root: PathBuf,
    /// The open folder relative to `root`, as git prints it: "" or "docs/".
    prefix: String,
    /// The open folder, as the app knows it (maybe through a symlink).
    folder: PathBuf,
}

/// The error text git printed, or a description of why it couldn't run.
type GitResult<T> = Result<T, String>;

fn command(git: &Path, dir: &Path) -> Command {
    let mut cmd = Command::new(git);
    cmd.current_dir(dir)
        // A repository's fsmonitor setting names a program to run on every status.
        .args(["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "-c", "color.ui=false"])
        .env("GIT_TERMINAL_PROMPT", "0")
        // Continuing a merge or a rebase takes git's default message instead of opening an editor.
        .env("GIT_EDITOR", "true")
        .env("GIT_PAGER", "cat")
        .stdin(Stdio::null());
    cmd
}

/// Runs git in `dir` and returns what it printed, or its error message.
fn run_in(dir: &Path, args: &[&str], input: Option<&str>) -> GitResult<String> {
    let git = binary().ok_or("Git isn't installed")?;
    let mut cmd = command(&git, dir);
    cmd.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    if input.is_some() {
        cmd.stdin(Stdio::piped());
    }
    let mut child = cmd.spawn().map_err(err)?;
    if let (Some(input), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin.write_all(input.as_bytes()).map_err(err)?;
    }
    let out = child.wait_with_output().map_err(err)?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&out.stderr);
    // Some failures (a merge with conflicts) explain themselves on stdout.
    let message = [stdout.trim(), stderr.trim()].into_iter().filter(|s| !s.is_empty()).collect::<Vec<_>>();
    Err(if message.is_empty() { format!("git {} failed", args.first().unwrap_or(&"")) } else { message.join("\n") })
}

impl Repo {
    /// The repository `folder` is in, if any. Only asks git where the
    /// repository is, which runs nothing from the repository's settings.
    pub fn find(folder: &Path) -> Option<Repo> {
        let out = run_in(folder, &["rev-parse", "--show-toplevel", "--show-prefix"], None).ok()?;
        let mut lines = out.lines();
        let root = PathBuf::from(lines.next()?.trim());
        let prefix = lines.next().unwrap_or("").trim().to_string();
        Some(Repo { root, prefix, folder: folder.to_path_buf() })
    }

    fn run(&self, args: &[&str]) -> GitResult<String> {
        run_in(&self.root, args, None)
    }

    /// `rel` (a path relative to the repository, as git prints them) on disk.
    /// Refuses anything that could leave the working tree or reach `.git`.
    fn path(&self, rel: &str) -> GitResult<PathBuf> {
        let path = Path::new(rel);
        let plain = !rel.is_empty() && path.components().all(|c| matches!(c, Component::Normal(_)));
        let in_git = path.components().next().is_some_and(|c| c.as_os_str() == ".git");
        if !plain || in_git {
            return Err(format!("{rel} isn't a file in the repository"));
        }
        Ok(self.root.join(path))
    }

    /// Where `rel` is in the open folder, if it's inside it.
    fn local(&self, rel: &str) -> Option<String> {
        let inside = rel.strip_prefix(self.prefix.as_str())?;
        Some(self.folder.join(inside).to_string_lossy().into_owned())
    }

    fn has_commits(&self) -> bool {
        self.run(&["rev-parse", "--verify", "--quiet", "HEAD"]).is_ok()
    }

    /// A merge or a rebase waiting for its conflicts to be resolved.
    fn operation(&self) -> Option<Operation> {
        let git_dir = self.run(&["rev-parse", "--absolute-git-dir"]).ok()?;
        let git_dir = Path::new(git_dir.trim());
        if git_dir.join("rebase-merge").exists() || git_dir.join("rebase-apply").exists() {
            Some(Operation::Rebase)
        } else if git_dir.join("MERGE_HEAD").exists() {
            Some(Operation::Merge)
        } else {
            None
        }
    }

    /// The contents of `spec` (`HEAD:a.md`, `:a.md` for the index), if it exists.
    fn blob(&self, spec: &str) -> Option<Vec<u8>> {
        let git = binary()?;
        let out = command(&git, &self.root).args(["cat-file", "blob", spec]).output().ok()?;
        out.status.success().then_some(out.stdout)
    }
}

#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    Merge,
    Rebase,
}

/// A changed file. Each side is git's one-letter status ("M", "A", "D", "R",
/// "C", "T", "?" for untracked), or `None` when unchanged on that side.
#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    /// Relative to the repository, with `/`.
    pub path: String,
    /// The path before a rename or copy.
    pub orig_path: Option<String>,
    /// In the index, compared with HEAD: what the next commit would change.
    pub staged: Option<String>,
    /// In the working tree, compared with the index.
    pub unstaged: Option<String>,
    pub conflicted: bool,
    /// The file in the open folder, when it's inside it.
    pub local: Option<String>,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// None when HEAD is detached.
    pub branch: Option<String>,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub has_commits: bool,
    pub operation: Option<Operation>,
    pub remotes: Vec<String>,
    pub files: Vec<FileChange>,
}

/// Parses `git status --porcelain=v2 --branch -z`.
fn parse_status(out: &str) -> Status {
    let side = |c: char| (c != '.').then(|| c.to_string());
    let mut status = Status::default();
    let mut entries = out.split('\0').filter(|e| !e.is_empty());
    while let Some(entry) = entries.next() {
        let mut kind = entry.splitn(2, ' ');
        let (Some(tag), Some(rest)) = (kind.next(), kind.next()) else { continue };
        match tag {
            "#" => {
                let (key, value) = rest.split_once(' ').unwrap_or((rest, ""));
                match key {
                    "branch.head" if value != "(detached)" => status.branch = Some(value.to_string()),
                    "branch.upstream" => status.upstream = Some(value.to_string()),
                    "branch.ab" => {
                        for n in value.split(' ') {
                            if let Some(a) = n.strip_prefix('+') {
                                status.ahead = a.parse().unwrap_or(0);
                            } else if let Some(b) = n.strip_prefix('-') {
                                status.behind = b.parse().unwrap_or(0);
                            }
                        }
                    }
                    _ => {}
                }
            }
            "1" | "2" | "u" => {
                // Fields before the path: 7 for ordinary changes, 8 for renames, 9 for conflicts.
                let before_path = match tag {
                    "1" => 7,
                    "2" => 8,
                    _ => 9,
                };
                let fields: Vec<&str> = rest.splitn(before_path + 1, ' ').collect();
                let (Some(xy), Some(path)) = (fields.first(), fields.get(before_path)) else { continue };
                let mut xy = xy.chars();
                let (x, y) = (xy.next().unwrap_or('.'), xy.next().unwrap_or('.'));
                let mut change = FileChange { path: path.to_string(), ..Default::default() };
                if tag == "u" {
                    change.conflicted = true;
                } else {
                    change.staged = side(x);
                    change.unstaged = side(y);
                }
                if tag == "2" {
                    change.orig_path = entries.next().map(str::to_string);
                }
                status.files.push(change);
            }
            "?" => status.files.push(FileChange {
                path: rest.to_string(),
                unstaged: Some("?".to_string()),
                ..Default::default()
            }),
            _ => {}
        }
    }
    status
}

pub fn status(repo: &Repo) -> GitResult<Status> {
    let out = run_in(
        &repo.root,
        &["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
        None,
    )?;
    let mut status = parse_status(&out);
    for file in &mut status.files {
        file.local = repo.local(&file.path);
    }
    status.has_commits = repo.has_commits();
    status.operation = repo.operation();
    status.remotes = repo.run(&["remote"])?.lines().map(str::to_string).collect();
    Ok(status)
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub email: String,
    /// ISO 8601.
    pub date: String,
    pub subject: String,
}

/// What Mido is about: Markdown documents and their comments. Pathspecs for `git log`.
const MARKDOWN_PATHSPECS: &[&str] = &[
    ":(glob,icase)**/*.md",
    ":(glob,icase)**/*.markdown",
    ":(glob,icase)**/*.mdown",
    ":(glob,icase)**/*.mkd",
    ":(glob,icase)**/*.mdx",
    ":(glob)**/.mido/comments/**",
];

/// The latest `limit` commits, of `path` only if given, or only those
/// touching Markdown documents (or their comments) with `markdown_only`.
pub fn log(repo: &Repo, limit: usize, path: Option<&str>, markdown_only: bool) -> GitResult<Vec<Commit>> {
    if !repo.has_commits() {
        return Ok(Vec::new());
    }
    let limit = format!("-n{limit}");
    let mut args = vec!["log", &limit, "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e"];
    if let Some(path) = path {
        repo.path(path)?;
        args.extend(["--", path]);
    } else if markdown_only {
        args.push("--");
        args.extend_from_slice(MARKDOWN_PATHSPECS);
    }
    Ok(parse_log(&repo.run(&args)?))
}

fn parse_log(out: &str) -> Vec<Commit> {
    out
        .split('\x1e')
        .filter_map(|record| {
            let f: Vec<&str> = record.trim_start_matches('\n').split('\x1f').collect();
            let [hash, short, author, email, date, subject] = f.as_slice() else { return None };
            Some(Commit {
                hash: hash.to_string(),
                short: short.to_string(),
                author: author.to_string(),
                email: email.to_string(),
                date: date.to_string(),
                subject: subject.to_string(),
            })
        })
        .collect()
}

/// The files a commit changed, compared with its first parent.
pub fn commit_files(repo: &Repo, hash: &str) -> GitResult<Vec<FileChange>> {
    check_hash(hash)?;
    let out = repo.run(&["diff-tree", "-r", "--root", "--no-commit-id", "--name-status", "-z", "-M", "-m", "--first-parent", hash])?;
    let mut fields = out.split('\0').filter(|f| !f.is_empty());
    let mut files = Vec::new();
    while let Some(code) = fields.next() {
        let letter = code.chars().next().unwrap_or('M').to_string();
        let renamed = matches!(letter.as_str(), "R" | "C");
        let orig_path = if renamed { fields.next().map(str::to_string) } else { None };
        let Some(path) = fields.next() else { break };
        files.push(FileChange {
            path: path.to_string(),
            orig_path,
            staged: Some(letter),
            local: repo.local(path),
            ..Default::default()
        });
    }
    Ok(files)
}

/// Commit ids come from the log, but they end up in git's arguments: only hex.
fn check_hash(hash: &str) -> GitResult<()> {
    if (4..=64).contains(&hash.len()) && hash.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(format!("{hash} isn't a commit"))
    }
}

/// Which two versions of a file a diff compares.
#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum DiffKind {
    /// The working tree against the index: changes not staged yet.
    Unstaged,
    /// The index against HEAD: what the next commit would change.
    Staged,
    /// A commit against its first parent.
    Commit,
    /// The working tree against HEAD: everything changed, staged or not.
    Working,
}

#[derive(Serialize, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileVersions {
    /// None when the file doesn't exist on that side (added or deleted).
    pub original: Option<String>,
    pub modified: Option<String>,
    /// Not text, or too big: there's nothing to show.
    pub binary: bool,
}

fn text(bytes: Option<Vec<u8>>, binary: &mut bool) -> Option<String> {
    let bytes = bytes?;
    if bytes.len() > MAX_DIFF_BYTES || bytes.iter().take(8000).any(|&b| b == 0) {
        *binary = true;
        return None;
    }
    Some(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn file_versions(
    repo: &Repo,
    kind: DiffKind,
    path: &str,
    orig_path: Option<&str>,
    commit: Option<&str>,
) -> GitResult<FileVersions> {
    let disk = repo.path(path)?;
    if let Some(orig) = orig_path {
        repo.path(orig)?;
    }
    let before = orig_path.unwrap_or(path);
    let (original, modified) = match kind {
        DiffKind::Unstaged => {
            // An untracked file isn't in the index: everything in it is new.
            (repo.blob(&format!(":{path}")), fs::read(&disk).ok())
        }
        DiffKind::Staged => {
            let head = if repo.has_commits() { repo.blob(&format!("HEAD:{before}")) } else { None };
            (head, repo.blob(&format!(":{path}")))
        }
        DiffKind::Working => {
            let head = if repo.has_commits() { repo.blob(&format!("HEAD:{before}")) } else { None };
            (head, fs::read(&disk).ok())
        }
        DiffKind::Commit => {
            let hash = commit.ok_or("No commit given")?;
            check_hash(hash)?;
            (repo.blob(&format!("{hash}^:{before}")), repo.blob(&format!("{hash}:{path}")))
        }
    };
    let mut versions = FileVersions::default();
    versions.original = text(original, &mut versions.binary);
    versions.modified = text(modified, &mut versions.binary);
    Ok(versions)
}

/// Literal pathspecs: a file named `*.md` means that file, not every Markdown file.
fn with_paths<'a>(repo: &Repo, args: &[&'a str], paths: &'a [String]) -> GitResult<Vec<&'a str>> {
    for path in paths {
        repo.path(path)?;
    }
    let mut all = vec!["--literal-pathspecs"];
    all.extend_from_slice(args);
    all.push("--");
    all.extend(paths.iter().map(String::as_str));
    Ok(all)
}

pub fn stage(repo: &Repo, paths: &[String]) -> GitResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    // `-A` stages deletions too.
    repo.run(&with_paths(repo, &["add", "-A"], paths)?).map(drop)
}

pub fn unstage(repo: &Repo, paths: &[String]) -> GitResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let args: &[&str] = if repo.has_commits() { &["restore", "--staged"] } else { &["rm", "--cached", "-r", "-q"] };
    repo.run(&with_paths(repo, args, paths)?).map(drop)
}

pub fn commit(repo: &Repo, message: &str) -> GitResult<String> {
    if message.trim().is_empty() {
        return Err("The commit message is empty".to_string());
    }
    // From stdin, so the message is never taken for an option.
    run_in(&repo.root, &["commit", "-F", "-"], Some(message))
}

pub fn push(repo: &Repo, set_upstream: Option<&str>) -> GitResult<String> {
    match set_upstream {
        Some(remote) => {
            if remote.is_empty() || remote.starts_with('-') {
                return Err(format!("{remote} isn't a remote"));
            }
            repo.run(&["push", "--set-upstream", remote, "HEAD"])
        }
        None => repo.run(&["push"]),
    }
}

#[derive(Deserialize, Debug, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum PullMode {
    Merge,
    Rebase,
}

pub fn pull(repo: &Repo, mode: PullMode) -> GitResult<String> {
    match mode {
        PullMode::Merge => repo.run(&["pull", "--no-rebase", "--no-edit"]),
        PullMode::Rebase => repo.run(&["pull", "--rebase"]),
    }
}

pub fn fetch(repo: &Repo) -> GitResult<String> {
    repo.run(&["fetch"])
}

/// Throws away the changes not staged yet: tracked files go back to their
/// staged (or committed) contents, untracked ones go to the Trash, so even
/// this can be undone from the Finder.
pub fn discard(repo: &Repo, paths: &[String]) -> GitResult<()> {
    if paths.is_empty() {
        return Ok(());
    }
    let status = status(repo)?;
    let (untracked, tracked): (Vec<String>, Vec<String>) = paths.iter().cloned().partition(|path| {
        status.files.iter().any(|f| &f.path == path && f.unstaged.as_deref() == Some("?"))
    });
    if !tracked.is_empty() {
        repo.run(&with_paths(repo, &["restore", "--worktree"], &tracked)?)?;
    }
    for path in &untracked {
        let disk = repo.path(path)?;
        // Trashing a symlink moves the link: its folder must be inside.
        writable_inside(&repo.root, disk.parent().unwrap_or(&repo.root))?;
        trash::delete(&disk).map_err(err)?;
    }
    Ok(())
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    /// "main", or "origin/main" for a remote branch.
    pub name: String,
    pub remote: bool,
    pub current: bool,
    /// The remote branch a local one tracks.
    pub upstream: Option<String>,
    /// When its last commit was made, ISO 8601.
    pub date: String,
    pub subject: String,
}

/// Branch names come from the user or the list, but end up in git's arguments.
fn check_branch(name: &str) -> GitResult<()> {
    let valid = !name.is_empty() && !name.starts_with('-') && run_in(Path::new("/"), &["check-ref-format", "--allow-onelevel", &format!("refs/heads/{name}")], None).is_ok();
    if valid {
        Ok(())
    } else {
        Err(format!("“{name}” isn't a valid branch name"))
    }
}

/// Local branches, then remote ones; the most recently committed to first.
pub fn branches(repo: &Repo) -> GitResult<Vec<Branch>> {
    let out = repo.run(&[
        "for-each-ref",
        "--sort=-committerdate",
        "--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(committerdate:iso8601-strict)%1f%(contents:subject)",
        "refs/heads",
        "refs/remotes",
    ])?;
    let mut list: Vec<Branch> = out
        .lines()
        .filter_map(|line| {
            let f: Vec<&str> = line.split('\x1f').collect();
            let [refname, name, head, upstream, date, subject] = f.as_slice() else { return None };
            // "origin/HEAD" only points at another remote branch.
            if refname.ends_with("/HEAD") && refname.starts_with("refs/remotes/") {
                return None;
            }
            Some(Branch {
                name: name.to_string(),
                remote: refname.starts_with("refs/remotes/"),
                current: *head == "*",
                upstream: (!upstream.is_empty()).then(|| upstream.to_string()),
                date: date.to_string(),
                subject: subject.to_string(),
            })
        })
        .collect();
    list.sort_by_key(|b| b.remote);
    Ok(list)
}

/// Switches to `name`. A remote branch ("origin/feature") gets a local branch
/// that tracks it, or switches to the local one already tracking it.
pub fn checkout(repo: &Repo, name: &str, remote: bool) -> GitResult<String> {
    check_branch(name)?;
    if !remote {
        return repo.run(&["switch", name]);
    }
    let local = name.split_once('/').map(|(_, rest)| rest).unwrap_or(name);
    let existing = branches(repo)?.into_iter().find(|b| !b.remote && b.name == local);
    match existing {
        Some(_) => repo.run(&["switch", local]),
        None => repo.run(&["switch", "--track", name]),
    }
}

/// Creates `name` from the current commit and switches to it.
pub fn create_branch(repo: &Repo, name: &str) -> GitResult<String> {
    check_branch(name)?;
    repo.run(&["switch", "-c", name])
}

/// Merges `name` into the current branch; conflicts stop it for the user to resolve.
pub fn merge_branch(repo: &Repo, name: &str) -> GitResult<String> {
    check_branch(name)?;
    repo.run(&["merge", "--no-edit", name])
}

/// Deletes a local branch, unless it has commits merged nowhere else.
pub fn delete_branch(repo: &Repo, name: &str) -> GitResult<String> {
    check_branch(name)?;
    repo.run(&["branch", "-d", name])
}

/// The commits a push would send: those not on the upstream, or on no remote
/// at all for a branch that hasn't been published.
pub fn outgoing(repo: &Repo) -> GitResult<Vec<Commit>> {
    if !repo.has_commits() {
        return Ok(Vec::new());
    }
    let has_upstream = repo.run(&["rev-parse", "--verify", "--quiet", "@{upstream}"]).is_ok();
    let range: &[&str] = if has_upstream { &["@{upstream}..HEAD"] } else { &["HEAD", "--not", "--remotes"] };
    let mut args = vec!["log", "-n500", "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e"];
    args.extend_from_slice(range);
    Ok(parse_log(&repo.run(&args)?))
}

/// Writes the resolved contents of a conflicted file and marks it resolved.
pub fn resolve(repo: &Repo, path: &str, content: &str) -> GitResult<()> {
    let disk = repo.path(path)?;
    writable_inside(&repo.root, &disk)?;
    write_atomic(&disk, content.as_bytes()).map_err(err)?;
    stage(repo, &[path.to_string()])
}

/// Finishes the merge or rebase once every conflict is resolved.
pub fn continue_operation(repo: &Repo) -> GitResult<String> {
    match repo.operation() {
        Some(Operation::Merge) => repo.run(&["merge", "--continue"]),
        Some(Operation::Rebase) => repo.run(&["rebase", "--continue"]),
        None => Err("There's no merge or rebase to continue".to_string()),
    }
}

/// Gives up the merge or rebase and goes back to how things were before it.
pub fn abort_operation(repo: &Repo) -> GitResult<String> {
    match repo.operation() {
        Some(Operation::Merge) => repo.run(&["merge", "--abort"]),
        Some(Operation::Rebase) => repo.run(&["rebase", "--abort"]),
        None => Err("There's no merge or rebase to abort".to_string()),
    }
}

/* ---------- Tauri state and commands ---------- */

/// The repositories the user let Mido run git in, saved across launches.
pub struct TrustedRepos(pub Mutex<Granted>);

/// One git command at a time per repository: two at once would fight over
/// `.git/index.lock` (two windows, or a click during a slow push).
#[derive(Default)]
pub struct RepoLocks(Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>);

impl RepoLocks {
    fn for_repo(&self, root: &Path) -> Arc<Mutex<()>> {
        let mut locks = self.0.lock().unwrap_or_else(|e| e.into_inner());
        locks.entry(root.to_path_buf()).or_default().clone()
    }
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RepoInfo {
    /// The repository's top folder.
    pub root: String,
    /// Whether the user let Mido run git here. Until then there's no status.
    pub trusted: bool,
    pub status: Option<Status>,
}

/// The open folder's repository, once trusted.
fn trusted_repo(workspace: &Workspace, trusted: &TrustedRepos) -> GitResult<Repo> {
    let repo = Repo::find(&workspace.root).ok_or("This folder isn't in a git repository")?;
    let ok = trusted.0.lock().map_err(err)?.contains(&repo.root);
    if !ok {
        return Err("Git isn't enabled for this repository".to_string());
    }
    Ok(repo)
}

/// Runs `f` on the trusted repository, off the main thread and alone in it.
async fn with_repo<T: Send + 'static>(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    f: impl FnOnce(&Repo) -> GitResult<T> + Send + 'static,
) -> GitResult<T> {
    let repo = trusted_repo(&workspace, &trusted)?;
    let lock = locks.for_repo(&repo.root);
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = lock.lock().unwrap_or_else(|e| e.into_inner());
        f(&repo)
    })
    .await
    .map_err(err)?
}

/// The repository the open folder is in, and its status once trusted.
/// `None` without git or outside a repository.
#[tauri::command]
pub async fn git_info(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
) -> GitResult<Option<RepoInfo>> {
    let folder = workspace.root.clone();
    let Some(repo) = tauri::async_runtime::spawn_blocking(move || Repo::find(&folder)).await.map_err(err)? else {
        return Ok(None);
    };
    let root = repo.root.to_string_lossy().into_owned();
    if !trusted.0.lock().map_err(err)?.contains(&repo.root) {
        return Ok(Some(RepoInfo { root, trusted: false, status: None }));
    }
    let status = with_repo(workspace, trusted, locks, status).await?;
    Ok(Some(RepoInfo { root, trusted: true, status: Some(status) }))
}

/// Asks, in a native prompt the webview can't fake or skip, whether Mido may
/// run git in the open folder's repository. Resolves to whether it may.
#[tauri::command]
pub async fn git_trust(app: AppHandle, workspace: Workspace, trusted: State<'_, TrustedRepos>) -> GitResult<bool> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

    let repo = Repo::find(&workspace.root).ok_or("This folder isn't in a git repository")?;
    if trusted.0.lock().map_err(err)?.contains(&repo.root) {
        return Ok(true);
    }
    let ok = app
        .dialog()
        .message(format!(
            "Mido will run git in “{}”, as Terminal would. Only do this for repositories you trust: their hooks and settings can run programs.",
            repo.root.display()
        ))
        .title("Use git in this repository?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Use Git".to_string(), "Cancel".to_string()))
        .blocking_show();
    if ok {
        trusted.0.lock().map_err(err)?.grant(&repo.root).map_err(err)?;
    }
    Ok(ok)
}

#[tauri::command]
pub async fn git_log(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    limit: usize,
    path: Option<String>,
    markdown_only: bool,
) -> GitResult<Vec<Commit>> {
    with_repo(workspace, trusted, locks, move |r| log(r, limit.min(1000), path.as_deref(), markdown_only)).await
}

#[tauri::command]
pub async fn git_commit_files(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    hash: String,
) -> GitResult<Vec<FileChange>> {
    with_repo(workspace, trusted, locks, move |r| commit_files(r, &hash)).await
}

#[tauri::command]
pub async fn git_file_versions(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    kind: DiffKind,
    path: String,
    orig_path: Option<String>,
    commit: Option<String>,
) -> GitResult<FileVersions> {
    with_repo(workspace, trusted, locks, move |r| {
        file_versions(r, kind, &path, orig_path.as_deref(), commit.as_deref())
    })
    .await
}

#[tauri::command]
pub async fn git_stage(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    paths: Vec<String>,
) -> GitResult<()> {
    with_repo(workspace, trusted, locks, move |r| stage(r, &paths)).await
}

#[tauri::command]
pub async fn git_unstage(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    paths: Vec<String>,
) -> GitResult<()> {
    with_repo(workspace, trusted, locks, move |r| unstage(r, &paths)).await
}

#[tauri::command]
pub async fn git_commit(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    message: String,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, move |r| commit(r, &message)).await
}

#[tauri::command]
pub async fn git_push(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    set_upstream: Option<String>,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, move |r| push(r, set_upstream.as_deref())).await
}

#[tauri::command]
pub async fn git_pull(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    mode: PullMode,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, move |r| pull(r, mode)).await
}

#[tauri::command]
pub async fn git_fetch(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, fetch).await
}

#[tauri::command]
pub async fn git_discard(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    paths: Vec<String>,
) -> GitResult<()> {
    with_repo(workspace, trusted, locks, move |r| discard(r, &paths)).await
}

#[tauri::command]
pub async fn git_branches(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
) -> GitResult<Vec<Branch>> {
    with_repo(workspace, trusted, locks, branches).await
}

#[tauri::command]
pub async fn git_checkout(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    name: String,
    remote: bool,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, move |r| checkout(r, &name, remote)).await
}

#[tauri::command]
pub async fn git_create_branch(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    name: String,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, move |r| create_branch(r, &name)).await
}

#[tauri::command]
pub async fn git_merge(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    name: String,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, move |r| merge_branch(r, &name)).await
}

#[tauri::command]
pub async fn git_delete_branch(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    name: String,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, move |r| delete_branch(r, &name)).await
}

#[tauri::command]
pub async fn git_outgoing(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
) -> GitResult<Vec<Commit>> {
    with_repo(workspace, trusted, locks, outgoing).await
}

#[tauri::command]
pub async fn git_resolve(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
    path: String,
    content: String,
) -> GitResult<()> {
    with_repo(workspace, trusted, locks, move |r| resolve(r, &path, &content)).await
}

#[tauri::command]
pub async fn git_continue(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, continue_operation).await
}

#[tauri::command]
pub async fn git_abort(
    workspace: Workspace,
    trusted: State<'_, TrustedRepos>,
    locks: State<'_, RepoLocks>,
) -> GitResult<String> {
    with_repo(workspace, trusted, locks, abort_operation).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_branch_and_changes() {
        let out = [
            "# branch.oid 1234",
            "# branch.head main",
            "# branch.upstream origin/main",
            "# branch.ab +2 -1",
            "1 .M N... 100644 100644 100644 aaa bbb notes/a file.md",
            "1 A. N... 000000 100644 100644 000 ccc new.md",
            "2 R. N... 100644 100644 100644 ddd ddd R100 moved.md",
            "old.md",
            "u UU N... 100644 100644 100644 100644 e1 e2 e3 both.md",
            "? untracked.md",
        ]
        .join("\0");
        let status = parse_status(&out);
        assert_eq!(status.branch.as_deref(), Some("main"));
        assert_eq!(status.upstream.as_deref(), Some("origin/main"));
        assert_eq!((status.ahead, status.behind), (2, 1));
        let summary: Vec<_> = status
            .files
            .iter()
            .map(|f| (f.path.as_str(), f.staged.as_deref(), f.unstaged.as_deref(), f.conflicted, f.orig_path.as_deref()))
            .collect();
        assert_eq!(
            summary,
            vec![
                ("notes/a file.md", None, Some("M"), false, None),
                ("new.md", Some("A"), None, false, None),
                ("moved.md", Some("R"), None, false, Some("old.md")),
                ("both.md", None, None, true, None),
                ("untracked.md", None, Some("?"), false, None),
            ]
        );
    }

    #[test]
    fn detached_head_has_no_branch() {
        assert_eq!(parse_status("# branch.head (detached)\0").branch, None);
    }

    #[test]
    fn refuses_paths_leaving_the_repository() {
        let repo = Repo { root: PathBuf::from("/r"), prefix: String::new(), folder: PathBuf::from("/r") };
        assert_eq!(repo.path("a/b.md").unwrap(), Path::new("/r/a/b.md"));
        for bad in ["", "/etc/passwd", "../x.md", "a/../../x", ".git/config", "./a.md"] {
            assert!(repo.path(bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn maps_repository_paths_into_the_open_folder() {
        let repo = Repo { root: PathBuf::from("/r"), prefix: "docs/".to_string(), folder: PathBuf::from("/link/docs") };
        assert_eq!(repo.local("docs/a.md").as_deref(), Some("/link/docs/a.md"));
        assert_eq!(repo.local("README.md"), None);
    }

    #[test]
    fn only_takes_hex_commit_ids() {
        assert!(check_hash("a1b2c3d").is_ok());
        for bad in ["", "abc", "--all", "HEAD", "a1b2c3d^"] {
            assert!(check_hash(bad).is_err(), "{bad} should be refused");
        }
    }

    /// A repository in a temporary folder, with a user so commits work anywhere.
    fn temp_repo() -> Option<(tempfile::TempDir, Repo)> {
        binary()?;
        let dir = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(dir.path()).unwrap();
        run_in(&root, &["init", "-q", "-b", "main"], None).ok()?;
        run_in(&root, &["config", "user.name", "Ada"], None).unwrap();
        run_in(&root, &["config", "user.email", "ada@example.com"], None).unwrap();
        run_in(&root, &["config", "commit.gpgsign", "false"], None).unwrap();
        let repo = Repo::find(&root).unwrap();
        Some((dir, repo))
    }

    #[test]
    fn stages_commits_and_lists_history() {
        let Some((_dir, repo)) = temp_repo() else { return };
        fs::write(repo.root.join("a.md"), "one\n").unwrap();
        assert_eq!(status(&repo).unwrap().files[0].unstaged.as_deref(), Some("?"));

        stage(&repo, &["a.md".to_string()]).unwrap();
        assert_eq!(status(&repo).unwrap().files[0].staged.as_deref(), Some("A"));
        unstage(&repo, &["a.md".to_string()]).unwrap();
        assert_eq!(status(&repo).unwrap().files[0].staged, None);

        stage(&repo, &["a.md".to_string()]).unwrap();
        commit(&repo, "First\n\nWith a body").unwrap();
        assert!(status(&repo).unwrap().files.is_empty());

        fs::write(repo.root.join("a.md"), "two\n").unwrap();
        let versions = file_versions(&repo, DiffKind::Unstaged, "a.md", None, None).unwrap();
        assert_eq!((versions.original.as_deref(), versions.modified.as_deref()), (Some("one\n"), Some("two\n")));
        stage(&repo, &["a.md".to_string()]).unwrap();
        commit(&repo, "Second").unwrap();

        let history = log(&repo, 10, None, false).unwrap();
        assert_eq!(history.iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["Second", "First"]);
        let files = commit_files(&repo, &history[0].hash).unwrap();
        assert_eq!(files[0].path, "a.md");
        let versions = file_versions(&repo, DiffKind::Commit, "a.md", None, Some(&history[0].hash)).unwrap();
        assert_eq!((versions.original.as_deref(), versions.modified.as_deref()), (Some("one\n"), Some("two\n")));
        // The first commit has no parent: the file is all new.
        let first = file_versions(&repo, DiffKind::Commit, "a.md", None, Some(&history[1].hash)).unwrap();
        assert_eq!((first.original, first.modified.as_deref()), (None, Some("one\n")));
    }

    #[test]
    fn refuses_an_empty_message() {
        let Some((_dir, repo)) = temp_repo() else { return };
        assert!(commit(&repo, "  \n").is_err());
    }

    #[test]
    fn takes_file_names_literally() {
        let Some((_dir, repo)) = temp_repo() else { return };
        fs::write(repo.root.join("a.md"), "").unwrap();
        fs::write(repo.root.join("*.md"), "").unwrap();
        stage(&repo, &["*.md".to_string()]).unwrap();
        let staged: Vec<_> = status(&repo).unwrap().files.into_iter().filter(|f| f.staged.is_some()).map(|f| f.path).collect();
        assert_eq!(staged, ["*.md"]);
    }

    #[test]
    fn resolves_a_merge_conflict() {
        let Some((_dir, repo)) = temp_repo() else { return };
        let git = |args: &[&str]| run_in(&repo.root, args, None);
        fs::write(repo.root.join("a.md"), "base\n").unwrap();
        stage(&repo, &["a.md".to_string()]).unwrap();
        commit(&repo, "Base").unwrap();
        git(&["checkout", "-q", "-b", "other"]).unwrap();
        fs::write(repo.root.join("a.md"), "theirs\n").unwrap();
        git(&["commit", "-qam", "Theirs"]).unwrap();
        git(&["checkout", "-q", "main"]).unwrap();
        fs::write(repo.root.join("a.md"), "ours\n").unwrap();
        git(&["commit", "-qam", "Ours"]).unwrap();
        assert!(git(&["merge", "other"]).is_err());

        let state = status(&repo).unwrap();
        assert_eq!(state.operation, Some(Operation::Merge));
        assert!(state.files[0].conflicted);

        resolve(&repo, "a.md", "both\n").unwrap();
        continue_operation(&repo).unwrap();
        let state = status(&repo).unwrap();
        assert_eq!(state.operation, None);
        assert!(state.files.is_empty());
        assert_eq!(fs::read_to_string(repo.root.join("a.md")).unwrap(), "both\n");
    }

    #[test]
    fn aborts_a_merge() {
        let Some((_dir, repo)) = temp_repo() else { return };
        let git = |args: &[&str]| run_in(&repo.root, args, None);
        fs::write(repo.root.join("a.md"), "base\n").unwrap();
        git(&["add", "a.md"]).unwrap();
        git(&["commit", "-qm", "Base"]).unwrap();
        git(&["checkout", "-q", "-b", "other"]).unwrap();
        fs::write(repo.root.join("a.md"), "theirs\n").unwrap();
        git(&["commit", "-qam", "Theirs"]).unwrap();
        git(&["checkout", "-q", "main"]).unwrap();
        fs::write(repo.root.join("a.md"), "ours\n").unwrap();
        git(&["commit", "-qam", "Ours"]).unwrap();
        assert!(git(&["merge", "other"]).is_err());
        abort_operation(&repo).unwrap();
        assert_eq!(status(&repo).unwrap().operation, None);
        assert_eq!(fs::read_to_string(repo.root.join("a.md")).unwrap(), "ours\n");
    }

    #[test]
    fn pushes_and_pulls_with_a_remote() {
        let Some((dir, repo)) = temp_repo() else { return };
        let remote = dir.path().join("remote.git");
        run_in(dir.path(), &["init", "-q", "--bare", "-b", "main", remote.to_str().unwrap()], None).unwrap();
        run_in(&repo.root, &["remote", "add", "origin", remote.to_str().unwrap()], None).unwrap();
        fs::write(repo.root.join("a.md"), "one\n").unwrap();
        stage(&repo, &["a.md".to_string()]).unwrap();
        commit(&repo, "One").unwrap();
        // No upstream yet: a plain push fails, publishing the branch works.
        assert!(push(&repo, None).is_err());
        push(&repo, Some("origin")).unwrap();
        assert_eq!(status(&repo).unwrap().upstream.as_deref(), Some("origin/main"));

        // Someone else pushes a commit.
        let other = dir.path().join("other");
        run_in(dir.path(), &["clone", "-q", remote.to_str().unwrap(), other.to_str().unwrap()], None).unwrap();
        for args in [&["config", "user.name", "Bo"][..], &["config", "user.email", "bo@example.com"]] {
            run_in(&other, args, None).unwrap();
        }
        fs::write(other.join("b.md"), "two\n").unwrap();
        run_in(&other, &["add", "b.md"], None).unwrap();
        run_in(&other, &["commit", "-qm", "Two"], None).unwrap();
        run_in(&other, &["push", "-q"], None).unwrap();

        fetch(&repo).unwrap();
        assert_eq!(status(&repo).unwrap().behind, 1);
        pull(&repo, PullMode::Merge).unwrap();
        assert_eq!(fs::read_to_string(repo.root.join("b.md")).unwrap(), "two\n");
        assert_eq!(status(&repo).unwrap().behind, 0);
    }

    #[test]
    fn discards_changes_and_trashes_new_files() {
        let Some((_dir, repo)) = temp_repo() else { return };
        fs::write(repo.root.join("a.md"), "one\n").unwrap();
        stage(&repo, &["a.md".to_string()]).unwrap();
        commit(&repo, "One").unwrap();
        fs::write(repo.root.join("a.md"), "changed\n").unwrap();
        discard(&repo, &["a.md".to_string()]).unwrap();
        assert_eq!(fs::read_to_string(repo.root.join("a.md")).unwrap(), "one\n");
        assert!(status(&repo).unwrap().files.is_empty());
        // A deleted file comes back too.
        fs::remove_file(repo.root.join("a.md")).unwrap();
        discard(&repo, &["a.md".to_string()]).unwrap();
        assert!(repo.root.join("a.md").exists());
        // Staged changes stay: only the working tree is reset.
        fs::write(repo.root.join("a.md"), "staged\n").unwrap();
        stage(&repo, &["a.md".to_string()]).unwrap();
        fs::write(repo.root.join("a.md"), "more\n").unwrap();
        discard(&repo, &["a.md".to_string()]).unwrap();
        assert_eq!(fs::read_to_string(repo.root.join("a.md")).unwrap(), "staged\n");
    }

    #[test]
    fn creates_switches_merges_and_deletes_branches() {
        let Some((_dir, repo)) = temp_repo() else { return };
        fs::write(repo.root.join("a.md"), "one\n").unwrap();
        stage(&repo, &["a.md".to_string()]).unwrap();
        commit(&repo, "One").unwrap();

        create_branch(&repo, "feature/x").unwrap();
        assert_eq!(status(&repo).unwrap().branch.as_deref(), Some("feature/x"));
        fs::write(repo.root.join("b.md"), "two\n").unwrap();
        stage(&repo, &["b.md".to_string()]).unwrap();
        commit(&repo, "Two").unwrap();

        checkout(&repo, "main", false).unwrap();
        let list = branches(&repo).unwrap();
        let names: Vec<_> = list.iter().map(|b| (b.name.as_str(), b.current)).collect();
        assert!(names.contains(&("main", true)) && names.contains(&("feature/x", false)));

        merge_branch(&repo, "feature/x").unwrap();
        assert!(repo.root.join("b.md").exists());
        delete_branch(&repo, "feature/x").unwrap();
        assert!(branches(&repo).unwrap().iter().all(|b| b.name != "feature/x"));

        for bad in ["", "-x", "a..b", "with space", "--force"] {
            assert!(create_branch(&repo, bad).is_err(), "{bad} should be refused");
        }
    }

    #[test]
    fn lists_the_commits_a_push_would_send() {
        let Some((dir, repo)) = temp_repo() else { return };
        fs::write(repo.root.join("a.md"), "one\n").unwrap();
        stage(&repo, &["a.md".to_string()]).unwrap();
        commit(&repo, "One").unwrap();
        // Not published: everything is outgoing.
        assert_eq!(outgoing(&repo).unwrap().len(), 1);
        let remote = dir.path().join("remote.git");
        run_in(dir.path(), &["init", "-q", "--bare", "-b", "main", remote.to_str().unwrap()], None).unwrap();
        run_in(&repo.root, &["remote", "add", "origin", remote.to_str().unwrap()], None).unwrap();
        push(&repo, Some("origin")).unwrap();
        assert!(outgoing(&repo).unwrap().is_empty());
        fs::write(repo.root.join("a.md"), "two\n").unwrap();
        stage(&repo, &["a.md".to_string()]).unwrap();
        commit(&repo, "Two").unwrap();
        assert_eq!(outgoing(&repo).unwrap().iter().map(|c| c.subject.as_str()).collect::<Vec<_>>(), ["Two"]);
        // The remote branch is listed, and checking it out finds the local one.
        assert!(branches(&repo).unwrap().iter().any(|b| b.remote && b.name == "origin/main"));
        checkout(&repo, "origin/main", true).unwrap();
        assert_eq!(status(&repo).unwrap().branch.as_deref(), Some("main"));
    }

    #[test]
    fn lists_only_commits_touching_markdown_when_asked() {
        let Some((_dir, repo)) = temp_repo() else { return };
        let add = |path: &str, text: &str, message: &str| {
            let disk = repo.root.join(path);
            fs::create_dir_all(disk.parent().unwrap()).unwrap();
            fs::write(disk, text).unwrap();
            stage(&repo, &[path.to_string()]).unwrap();
            commit(&repo, message).unwrap();
        };
        add("a.md", "one", "Top-level doc");
        add("src/main.rs", "fn main() {}", "Code only");
        add("docs/deep/B.MD", "two", "Nested doc");
        add(".mido/comments/a.md/t/1.json", "{}", "A comment");
        let subjects = |list: Vec<Commit>| list.into_iter().map(|c| c.subject).collect::<Vec<_>>();
        assert_eq!(subjects(log(&repo, 10, None, true).unwrap()), ["A comment", "Nested doc", "Top-level doc"]);
        assert_eq!(log(&repo, 10, None, false).unwrap().len(), 4);
    }

    #[test]
    fn finds_the_repository_above_the_open_folder() {
        let Some((_dir, repo)) = temp_repo() else { return };
        fs::create_dir(repo.root.join("docs")).unwrap();
        fs::write(repo.root.join("docs/a.md"), "").unwrap();
        fs::write(repo.root.join("top.md"), "").unwrap();
        let inner = Repo::find(&repo.root.join("docs")).unwrap();
        assert_eq!(inner.root, repo.root);
        let files = status(&inner).unwrap().files;
        let local = |p: &str| files.iter().find(|f| f.path == p).unwrap().local.clone();
        assert_eq!(local("docs/a.md"), Some(repo.root.join("docs/a.md").to_string_lossy().into_owned()));
        assert_eq!(local("top.md"), None);
    }
}
