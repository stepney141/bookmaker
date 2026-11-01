import { updateSettings } from "@/features/settings/api/update-settings";
import { SettingsView } from "@/features/settings/components/settings-view";

import { useAppData } from "../provider";

import type { JSX } from "react";

export function SettingsRoute(): JSX.Element {
  const { settings, setSettings } = useAppData();
  return <SettingsView settings={settings} onSave={(nextSettings) => updateSettings(nextSettings).then(setSettings)} />;
}
