import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Database, RefreshCw, Save } from "lucide-react";
import { Select } from "./components";
import { api } from "./session";
import type { SaveStatus } from "./session";
import { applyTheme } from "./theme";

const settingsSchema = z.object({
  logo: z.string().max(500000),
  academicSession: z.string().max(40),
  contactEmail: z.union([z.email(), z.literal("")]),
  contactPhone: z.string().max(40),
  notifications: z.boolean(),
  defaultNegativeMarks: z.number().min(0).max(100),
  defaultPassPercentage: z.number().min(1).max(100),
  theme: z.enum(["dark", "light", "system"]),
});
type InstitutionSettings = z.infer<typeof settingsSchema>;
interface SettingsSnapshot {
  settings: Partial<InstitutionSettings>;
  revision: number;
}
const defaults: InstitutionSettings = {
  logo: "",
  academicSession: "",
  contactEmail: "",
  contactPhone: "",
  notifications: true,
  defaultNegativeMarks: 0,
  defaultPassPercentage: 40,
  theme: "dark",
};

/** Key by actor + institution: an unfinished draft must not cross accounts/schools. */
export default function InstitutionDefaults({
  actorId,
  schoolId,
  status,
  reload,
  onThemeSaved,
  toast,
}: {
  actorId: string;
  schoolId: string;
  status: SaveStatus;
  reload: () => Promise<void>;
  onThemeSaved: (theme: string) => void;
  toast: (message: string) => void;
}) {
  const client = useQueryClient(),
    key = ["institution-settings", actorId, schoolId],
    settings = useQuery<SettingsSnapshot>({
      queryKey: key,
      queryFn: () => api(`/schools/${schoolId}/settings`),
    }),
    form = useForm<InstitutionSettings>({
      resolver: zodResolver(settingsSchema),
      defaultValues: defaults,
    }),
    { reset } = form,
    isDirty = form.formState.isDirty,
    dirtyNow = useRef(isDirty),
    active = useRef(true),
    [baseRevision, setBaseRevision] = useState<number>(),
    [refreshing, setRefreshing] = useState(false);
  dirtyNow.current = isDirty;
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    // Load complete defaults before enabling editing. Refetches may update a
    // pristine form, but must never replace a dirty draft or its CAS baseline.
    if (settings.data && !dirtyNow.current) {
      reset({ ...defaults, ...settings.data.settings });
      setBaseRevision(settings.data.revision);
    }
  }, [settings.data, reset]);
  const save = useMutation({
    mutationFn: (values: InstitutionSettings) => {
      if (baseRevision === undefined)
        throw new Error("Load institution settings before saving.");
      return api<SettingsSnapshot>(`/schools/${schoolId}/settings`, {
        method: "PUT",
        body: JSON.stringify({ ...values, revision: baseRevision }),
      });
    },
    onSuccess: async (snapshot) => {
      if (!active.current) return;
      // Publish the acknowledged snapshot BEFORE reload can remount the form.
      // An old cached GET must not erase a successfully saved field on remount.
      client.setQueryData(key, snapshot);
      reset({ ...defaults, ...snapshot.settings });
      setBaseRevision(snapshot.revision);
      const theme = snapshot.settings.theme || defaults.theme;
      applyTheme(theme);
      onThemeSaved(theme);
      toast("Institution settings saved with revision protection.");
      void client.invalidateQueries({ queryKey: ["audit"] });
      await reload();
    },
    onError: (error) => {
      if (active.current) toast(error.message);
    },
  });
  const reloadDraft = async () => {
    if (
      isDirty &&
      !window.confirm(
        "Discard these unsaved institution settings and reload the server version?",
      )
    )
      return;
    setRefreshing(true);
    try {
      const response = await settings.refetch();
      if (!active.current) return;
      if (response.error || !response.data)
        throw (
          response.error ||
          new Error("Institution settings could not be loaded.")
        );
      reset({ ...defaults, ...response.data.settings });
      setBaseRevision(response.data.revision);
      save.reset();
    } catch (error) {
      if (active.current)
        toast(
          error instanceof Error
            ? error.message
            : "Settings reload failed; your draft is retained.",
        );
    } finally {
      if (active.current) setRefreshing(false);
    }
  };
  const locked = baseRevision === undefined || save.isPending || refreshing;
  return (
    <section className="card institution-settings-card">
      <div className="card-heading">
        <div>
          <h2>
            <Database size={18} />
            Institution defaults
          </h2>
          <p>
            New exam defaults, contact details, session and notification
            preferences.
          </p>
        </div>
      </div>
      {baseRevision === undefined && !settings.error && (
        <p className="small muted" role="status">
          Loading institution defaults…
        </p>
      )}
      {settings.error && (
        <p className="form-error" role="alert">
          {settings.error.message}
        </p>
      )}
      {save.error && (
        <p className="form-error" role="alert">
          {save.error.message} Your draft is retained.
        </p>
      )}
      {isDirty && (
        <p className="small muted">
          Unsaved institution settings · background refresh will not replace
          this draft.
        </p>
      )}
      <button
        type="button"
        className="text-button"
        disabled={save.isPending || refreshing}
        onClick={() => void reloadDraft()}
      >
        <RefreshCw size={14} /> Reload institution defaults
      </button>
      <form onSubmit={form.handleSubmit((v) => save.mutate(v))}>
        <fieldset
          className="form-fields institution-settings-fields"
          disabled={locked}
        >
          <div className="institution-logo-field">
            <label>
              Report / institution logo
              <input
                aria-label="Upload institution logo"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const target = e.currentTarget,
                    file = target.files?.[0];
                  if (!file) return;
                  try {
                    const { normaliseLogo } = await import("./sheetImages");
                    form.setValue("logo", await normaliseLogo(file), {
                      shouldDirty: true,
                    });
                  } catch (e) {
                    toast(
                      e instanceof Error ? e.message : "Logo upload failed.",
                    );
                  } finally {
                    target.value = "";
                  }
                }}
              />
            </label>
            {form.watch("logo") && (
              <>
                <img src={form.watch("logo")} alt="Institution report logo" />
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() =>
                    form.setValue("logo", "", { shouldDirty: true })
                  }
                >
                  Remove logo
                </button>
              </>
            )}
          </div>
          <div className="import-mapping-grid">
            <label>
              Academic session
              <input {...form.register("academicSession")} />
            </label>
            <label>
              Contact email
              <input type="email" {...form.register("contactEmail")} />
            </label>
            <label>
              Contact phone
              <input {...form.register("contactPhone")} />
            </label>
            <label>
              Default negative marks
              <input
                type="number"
                min={0}
                max={100}
                step="0.01"
                {...form.register("defaultNegativeMarks", {
                  valueAsNumber: true,
                })}
              />
            </label>
            <label>
              Default pass percentage
              <input
                type="number"
                min={1}
                max={100}
                {...form.register("defaultPassPercentage", {
                  valueAsNumber: true,
                })}
              />
            </label>
            <label>
              Default color theme
              <Select {...form.register("theme")}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </Select>
            </label>
          </div>
          <label className="checkbox-label">
            <input type="checkbox" {...form.register("notifications")} />
            Show assessment review notifications
          </label>
          {Object.values(form.formState.errors).map((e, i) => (
            <p className="form-error" key={i}>
              {e.message}
            </p>
          ))}
          <button
            className="button button-primary"
            disabled={locked || status !== "saved"}
          >
            <Save size={16} />
            Save institution defaults
          </button>
        </fieldset>
      </form>
    </section>
  );
}
