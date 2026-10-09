//! Mido Pro: a license bought once from Polar (polar.sh), which sells it and
//! handles the taxes. A license key works on a few computers: each one
//! activates it once, keeps its activation id, and checks with Polar every
//! week that it's still valid (it isn't after a refund, or when the customer
//! frees the computer from their purchases page). Offline, it keeps working
//! for a month after the last check. A license from the sandbox (Polar's test
//! store, which development builds use) doesn't count with the real one.
//!
//! The calls are Polar's public license key API: no token in the app.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

/// Where licenses are sold and checked.
struct Store {
    api: &'static str,
    organization: &'static str,
    /// The customers' purchases page, where they find their key and free their computers.
    portal: &'static str,
    /// Where to buy one.
    checkout: Option<&'static str>,
}

/// Polar's test environment: no real money. Development builds use it.
static SANDBOX: Store = Store {
    api: "https://sandbox-api.polar.sh",
    organization: "ba13ae17-5462-4daa-ae4c-7a053f07dc7e",
    portal: "https://sandbox.polar.sh/heptartle/portal",
    checkout: Some(
        "https://sandbox-api.polar.sh/v1/checkout-links/polar_cl_xq96K9fCthPTBnp9cbmBrGUl1H34pKcekYCCF1JIzc5/redirect",
    ),
};

/// The real store: released builds sell and check licenses here.
static LIVE: Store = Store {
    api: "https://api.polar.sh",
    organization: "6d5af3c8-e4b5-419b-903a-d5f16e2f7cd6",
    portal: "https://polar.sh/heptartle/portal",
    checkout: Some("https://buy.polar.sh/polar_cl_7rx2EA2d5ZJutB9mOA0gM5FukZuDnSSG2Dqgf06sHzz"),
};

/// Released builds use the real store, whatever the environment says (a test
/// license is free). Development builds use the sandbox, or the real store
/// with `MIDO_POLAR=live`, to try a real purchase.
fn store() -> Option<&'static Store> {
    if !cfg!(debug_assertions) || std::env::var("MIDO_POLAR").is_ok_and(|v| v == "live") {
        Some(&LIVE)
    } else {
        Some(&SANDBOX)
    }
}

/// How often it checks with Polar, and how long it keeps working when it can't.
const REFRESH: Duration = Duration::from_secs(7 * 24 * 3600);
const GRACE: Duration = Duration::from_secs(30 * 24 * 3600);
const TIMEOUT: Duration = Duration::from_secs(15);

/// The license activated on this computer, as saved.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
struct Saved {
    key: String,
    /// This computer's activation.
    activation: String,
    /// Who bought it.
    email: Option<String>,
    /// The API it was activated with: a test license doesn't count in a released build.
    api: String,
    /// When Polar last said it's valid, in seconds since 1970.
    checked: u64,
}

impl Saved {
    fn valid_at(&self, now: u64, store: &Store) -> bool {
        self.api == store.api && now.saturating_sub(self.checked) < GRACE.as_secs()
    }
}

pub struct Licenses {
    path: PathBuf,
    saved: Mutex<Option<Saved>>,
    /// Why the license stopped working, until the user sees it.
    problem: Mutex<Option<String>>,
}

impl Licenses {
    pub fn load(path: PathBuf) -> Licenses {
        let saved = std::fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok());
        Licenses { path, saved: Mutex::new(saved), problem: Mutex::new(None) }
    }

    /// Whether Mido Pro is on, on this computer.
    pub fn active(&self) -> bool {
        let Some(store) = store() else { return false };
        let saved = self.saved.lock().ok().and_then(|s| s.clone());
        saved.is_some_and(|s| s.valid_at(now(), store))
    }

    fn save(&self, saved: Option<Saved>) -> Result<(), String> {
        match &saved {
            Some(s) => {
                let json = serde_json::to_vec_pretty(s).map_err(crate::err)?;
                if let Some(dir) = self.path.parent() {
                    std::fs::create_dir_all(dir).map_err(crate::err)?;
                }
                std::fs::write(&self.path, json).map_err(crate::err)?;
            }
            None => match std::fs::remove_file(&self.path) {
                Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(crate::err(e)),
                _ => {}
            },
        }
        *self.saved.lock().map_err(crate::err)? = saved;
        Ok(())
    }

    fn status(&self) -> Status {
        let store = store();
        let saved = self.saved.lock().ok().and_then(|s| s.clone());
        Status {
            available: store.is_some(),
            active: self.active(),
            key: saved.as_ref().map(|s| masked(&s.key)),
            email: saved.and_then(|s| s.email),
            problem: self.problem.lock().ok().and_then(|p| p.clone()),
            portal: store.map(|s| s.portal.to_string()),
            checkout: store.and_then(|s| s.checkout).map(str::to_string),
        }
    }
}

/// What the app shows about the license.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// Mido Pro is on sale (it isn't in released builds until the store opens).
    available: bool,
    active: bool,
    /// The key, mostly hidden.
    key: Option<String>,
    email: Option<String>,
    /// Why it stopped working, if it did.
    problem: Option<String>,
    portal: Option<String>,
    checkout: Option<String>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// `MIDO-0DB3…0C48`: enough to tell which, not enough to use.
fn masked(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    if chars.len() <= 12 {
        return "…".to_string();
    }
    let start: String = chars[..9].iter().collect();
    let end: String = chars[chars.len() - 4..].iter().collect();
    format!("{start}…{end}")
}

/// What this computer is called in the customer's purchases page.
fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    if let Ok(out) = std::process::Command::new("scutil").args(["--get", "ComputerName"]).output() {
        let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if out.status.success() && !name.is_empty() {
            return name;
        }
    }
    std::env::var("COMPUTERNAME").or_else(|_| std::env::var("HOSTNAME")).unwrap_or_else(|_| "Computer".to_string())
}

/// What Polar said: its HTTP status and body, or that it couldn't be reached.
#[derive(Debug)]
enum Reply {
    Answered(u16, Value),
    Unreachable(String),
}

async fn post(store: &Store, action: &str, body: Value) -> Reply {
    // The TLS library needs a crypto provider; the updater installs the same one.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = match reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(concat!("Mido/", env!("CARGO_PKG_VERSION")))
        .build()
    {
        Ok(client) => client,
        Err(e) => return Reply::Unreachable(e.to_string()),
    };
    let url = format!("{}/v1/customer-portal/license-keys/{action}", store.api);
    match client.post(url).json(&body).send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let body = response.json::<Value>().await.unwrap_or(Value::Null);
            Reply::Answered(status, body)
        }
        Err(e) => Reply::Unreachable(e.to_string()),
    }
}

/// What a check with Polar means for the saved license: kept (checked now or
/// not), or gone, with why.
fn after_check(saved: &Saved, reply: &Reply, now: u64) -> Result<Saved, String> {
    match reply {
        Reply::Answered(200, body) if body["status"] == "granted" => {
            let email = body["customer"]["email"].as_str().map(str::to_string).or_else(|| saved.email.clone());
            Ok(Saved { checked: now, email, ..saved.clone() })
        }
        Reply::Answered(200, _) => Err("Your Mido Pro license has been turned off (refunded or revoked).".into()),
        Reply::Answered(404, _) => Err("Mido Pro was turned off on this computer from your purchases page.".into()),
        // Polar is down, or there's no network: it's tried again later.
        _ => Ok(saved.clone()),
    }
}

/// Checks the license with Polar, if it's been a while, and tells where it stands.
#[tauri::command]
pub async fn license_check(licenses: State<'_, Licenses>) -> Result<Status, String> {
    let saved = licenses.saved.lock().map_err(crate::err)?.clone();
    let (Some(store), Some(saved)) = (store(), saved) else { return Ok(licenses.status()) };
    if saved.api != store.api || now().saturating_sub(saved.checked) < REFRESH.as_secs() {
        return Ok(licenses.status());
    }
    let body = json!({ "key": saved.key, "organization_id": store.organization, "activation_id": saved.activation });
    let reply = post(store, "validate", body).await;
    match after_check(&saved, &reply, now()) {
        Ok(checked) => licenses.save(Some(checked))?,
        Err(problem) => {
            licenses.save(None)?;
            *licenses.problem.lock().map_err(crate::err)? = Some(problem);
        }
    }
    Ok(licenses.status())
}

/// Activates a license key on this computer.
#[tauri::command]
pub async fn license_activate(licenses: State<'_, Licenses>, key: String) -> Result<Status, String> {
    let store = store().ok_or("Mido Pro isn't on sale yet.")?;
    let key = key.trim().to_string();
    if key.is_empty() || key.len() > 200 {
        return Err("Paste your license key.".into());
    }
    let label = computer_name();
    let body = json!({ "key": key, "organization_id": store.organization, "label": label,
        "meta": { "version": env!("CARGO_PKG_VERSION") } });
    let activation = match post(store, "activate", body).await {
        Reply::Answered(200, body) => body["id"].as_str().map(str::to_string).ok_or("Polar's answer had no activation")?,
        Reply::Answered(403, _) => {
            return Err(
                "This license is already active on as many computers as it allows. Free one from your purchases page."
                    .into(),
            )
        }
        Reply::Answered(404 | 422, _) => return Err("There's no Mido Pro license with that key.".into()),
        Reply::Answered(status, body) => return Err(format!("Polar couldn't activate it ({status}: {})", body["detail"])),
        Reply::Unreachable(e) => return Err(format!("Couldn't reach Polar to activate it: {e}")),
    };
    let saved = Saved { key, activation, email: None, api: store.api.to_string(), checked: 0 };
    // Checking it now also tells who it belongs to.
    let body = json!({ "key": saved.key, "organization_id": store.organization, "activation_id": saved.activation });
    let checked = after_check(&saved, &post(store, "validate", body).await, now())?;
    licenses.save(Some(Saved { checked: checked.checked.max(now()), ..checked }))?;
    *licenses.problem.lock().map_err(crate::err)? = None;
    Ok(licenses.status())
}

/// Frees this computer's place on the license, and turns Mido Pro off here.
#[tauri::command]
pub async fn license_deactivate(licenses: State<'_, Licenses>) -> Result<Status, String> {
    let saved = licenses.saved.lock().map_err(crate::err)?.clone();
    if let (Some(store), Some(saved)) = (store(), saved) {
        if saved.api == store.api {
            let body = json!({ "key": saved.key, "organization_id": store.organization, "activation_id": saved.activation });
            match post(store, "deactivate", body).await {
                // Freed, or already gone.
                Reply::Answered(200..=299 | 404, _) => {}
                Reply::Answered(status, _) => return Err(format!("Polar couldn't free this computer ({status}).")),
                Reply::Unreachable(e) => return Err(format!("Couldn't reach Polar to free this computer: {e}")),
            }
        }
    }
    licenses.save(None)?;
    *licenses.problem.lock().map_err(crate::err)? = None;
    Ok(licenses.status())
}

/// For the assistant's commands: an error unless Mido Pro is on.
pub fn require(licenses: &Licenses) -> Result<(), String> {
    if licenses.active() {
        Ok(())
    } else {
        Err("The assistant is part of Mido Pro.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(checked: u64) -> Saved {
        Saved {
            key: "MIDO-0DB35380-3E2C-4D08-9124-ADA98A870C48".into(),
            activation: "a".into(),
            email: None,
            api: SANDBOX.api.into(),
            checked,
        }
    }

    #[test]
    fn keeps_working_offline_for_a_month() {
        let day = 24 * 3600;
        assert!(saved(1000 * day).valid_at(1029 * day, &SANDBOX));
        assert!(!saved(1000 * day).valid_at(1031 * day, &SANDBOX));
        // A test license doesn't count against another store.
        let other = Store { api: "https://api.polar.sh", ..SANDBOX };
        assert!(!saved(1000 * day).valid_at(1000 * day, &other));
    }

    #[test]
    fn follows_what_polar_says() {
        let license = saved(10);
        let granted = Reply::Answered(200, json!({ "status": "granted", "customer": { "email": "a@b.it" } }));
        assert_eq!(after_check(&license, &granted, 99).unwrap(), Saved { checked: 99, email: Some("a@b.it".into()), ..saved(10) });
        assert!(after_check(&license, &Reply::Answered(200, json!({ "status": "revoked" })), 99).is_err());
        assert!(after_check(&license, &Reply::Answered(404, Value::Null), 99).is_err());
        // Down or offline: unchanged, still counting from the last check.
        assert_eq!(after_check(&license, &Reply::Answered(503, Value::Null), 99).unwrap(), license);
        assert_eq!(after_check(&license, &Reply::Unreachable("offline".into()), 99).unwrap(), license);
    }

    #[test]
    fn hides_most_of_the_key() {
        assert_eq!(masked("MIDO-0DB35380-3E2C-4D08-9124-ADA98A870C48"), "MIDO-0DB3…0C48");
        assert_eq!(masked("short"), "…");
    }

    #[test]
    fn saves_and_forgets_the_license() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("license.json");
        let licenses = Licenses::load(path.clone());
        assert!(!licenses.active());
        licenses.save(Some(saved(now()))).unwrap();
        assert!(Licenses::load(path.clone()).active());
        licenses.save(None).unwrap();
        assert!(!path.exists());
        assert!(!Licenses::load(path).active());
    }

    /// Against Polar's sandbox, with a test key from it:
    /// `MIDO_TEST_LICENSE=MIDO-… cargo test license::tests::real -- --ignored`
    #[test]
    #[ignore]
    fn real_activates_checks_and_frees() {
        let key = std::env::var("MIDO_TEST_LICENSE").expect("MIDO_TEST_LICENSE");
        tauri::async_runtime::block_on(async {
            let body = json!({ "key": key, "organization_id": SANDBOX.organization, "label": "mido-test" });
            let Reply::Answered(200, activated) = post(&SANDBOX, "activate", body).await else { panic!("activate") };
            let activation = activated["id"].as_str().unwrap().to_string();
            let license = Saved { key: key.clone(), activation: activation.clone(), email: None, api: SANDBOX.api.into(), checked: 0 };
            let body = json!({ "key": key, "organization_id": SANDBOX.organization, "activation_id": activation });
            let checked = after_check(&license, &post(&SANDBOX, "validate", body.clone()).await, 5).unwrap();
            assert_eq!(checked.checked, 5);
            assert!(checked.email.is_some());
            let Reply::Answered(204, _) = post(&SANDBOX, "deactivate", body.clone()).await else { panic!("deactivate") };
            assert!(after_check(&license, &post(&SANDBOX, "validate", body).await, 6).is_err());
        });
    }

    /// The real store knows the organization: a made-up key isn't found (and nothing is activated).
    /// `cargo test license::tests::real_store -- --ignored`
    #[test]
    #[ignore]
    fn real_store_answers() {
        tauri::async_runtime::block_on(async {
            let body = json!({ "key": "MIDO-00000000-0000-4000-8000-000000000000", "organization_id": LIVE.organization });
            assert!(matches!(post(&LIVE, "validate", body).await, Reply::Answered(404, _)));
        });
    }
}
