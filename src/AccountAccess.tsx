import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  WifiOff,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Logo, Modal } from "./components";
import { api, useSession } from "./session";

const offlineSchema = z.object({
  email: z.email(),
  passphrase: z
    .string()
    .min(12, "Use your 12-character-or-longer offline passphrase."),
});
export function OfflineUnlock({ onClose }: { onClose: () => void }) {
  const session = useSession(),
    [error, setError] = useState("");
  const form = useForm<z.infer<typeof offlineSchema>>({
    resolver: zodResolver(offlineSchema),
  });
  return (
    <Modal title="Unlock this device’s private workspace" onClose={onClose}>
      <form
        onSubmit={form.handleSubmit(async (data) => {
          setError("");
          try {
            await session.unlockOffline(data.email, data.passphrase);
            onClose();
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Could not unlock this device.",
            );
          }
        })}
      >
        <div className="modal-body form-fields no-padding">
          <div className="v2-notice">
            <WifiOff size={20} />
            <p>
              Only previously downloaded, authorized school records are
              available. Offline access expires 24 hours after server
              verification. Your passphrase is never stored.
            </p>
          </div>
          <label>
            Email address
            <input
              type="email"
              autoComplete="username"
              {...form.register("email")}
            />
          </label>
          <label>
            Offline vault passphrase
            <input
              type="password"
              autoComplete="off"
              {...form.register("passphrase")}
            />
          </label>
          {Object.values(form.formState.errors).map((e, i) => (
            <p className="form-error" key={i}>
              {e.message}
            </p>
          ))}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={form.formState.isSubmitting}
          >
            <LockKeyhole size={16} />
            Unlock encrypted cache
          </button>
        </div>
      </form>
    </Modal>
  );
}
const emailSchema = z.object({ email: z.email() });
export function RecoveryRequest({ onClose }: { onClose: () => void }) {
  const [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const form = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
  });
  return (
    <Modal title="Recover your account" onClose={onClose}>
      <form
        onSubmit={form.handleSubmit(async (data) => {
          setError("");
          try {
            setMessage(
              (
                await api<{ message: string }>("/auth/recovery/request", {
                  method: "POST",
                  body: JSON.stringify(data),
                })
              ).message,
            );
          } catch (e) {
            setError(
              e instanceof Error ? e.message : "Recovery request failed.",
            );
          }
        })}
      >
        <div className="modal-body form-fields no-padding">
          <p className="muted">
            A single-use link is emailed only when your institution has
            configured delivery. Otherwise ask your administrator for a verified
            reset.
          </p>
          <label>
            Email address
            <input
              type="email"
              autoComplete="username"
              {...form.register("email")}
            />
          </label>
          {form.formState.errors.email && (
            <p className="form-error">{form.formState.errors.email.message}</p>
          )}
          {message && (
            <p className="v2-notice" role="status">
              {message}
            </p>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="button button-secondary"
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="button button-primary"
            disabled={form.formState.isSubmitting}
          >
            <KeyRound size={16} />
            Request recovery link
          </button>
        </div>
      </form>
    </Modal>
  );
}
const resetSchema = z
  .object({ password: z.string().min(12).max(128), confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "Passwords must match.",
  });
export default function ResetAccount() {
  const [params] = useSearchParams(),
    navigate = useNavigate(),
    [success, setSuccess] = useState(false),
    [error, setError] = useState("");
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
  });
  return (
    <div className="initial-loader reset-account">
      <Logo />
      <div className="card">
        <span className="eyebrow">SECURE ACCOUNT RECOVERY</span>
        <h1>{success ? "Your account is ready." : "Choose a new password."}</h1>
        {success ? (
          <>
            <p>
              All previous sessions have been revoked. Sign in again with your
              new password.
            </p>
            <button
              className="button button-primary"
              onClick={() => navigate("/overview", { replace: true })}
            >
              Return to sign in
            </button>
          </>
        ) : (
          <form
            className="form-fields no-padding"
            onSubmit={form.handleSubmit(async (data) => {
              setError("");
              try {
                await api("/auth/recovery/reset", {
                  method: "POST",
                  body: JSON.stringify({
                    token: params.get("token") || "",
                    password: data.password,
                  }),
                });
                // Remove the bearer recovery token from browser history immediately after use.
                navigate("/reset", { replace: true });
                setSuccess(true);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Recovery failed.");
              }
            })}
          >
            <label>
              New password
              <input
                type="password"
                autoComplete="new-password"
                {...form.register("password")}
              />
            </label>
            <label>
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                {...form.register("confirm")}
              />
            </label>
            {Object.values(form.formState.errors).map((e, i) => (
              <p className="form-error" key={i}>
                {e.message}
              </p>
            ))}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button button-primary"
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? (
                <LoaderCircle className="spinning" size={16} />
              ) : (
                <KeyRound size={16} />
              )}
              Reset password
            </button>
          </form>
        )}
        <button className="text-button" onClick={() => navigate("/overview")}>
          <ArrowLeft size={14} />
          Back to workspace
        </button>
      </div>
    </div>
  );
}
