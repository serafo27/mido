// Wires `host:theme` from the bridge to lib/hostTheme.
import { setHostTheme, type HostThemeMessage } from "../lib/hostTheme";
import { on } from "./bridge";

on("host:theme", ({ payload }) => setHostTheme(payload as HostThemeMessage));
