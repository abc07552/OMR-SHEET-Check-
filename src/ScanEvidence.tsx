import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Image, Layers3, LoaderCircle } from "lucide-react";
import type { Result } from "./data";
import { api, API_BASE, useSession } from "./session";
import { Select } from "./components";
export default function ScanEvidence({
  result,
  school,
  question,
  questionsPerPage,
}: {
  result: Result;
  school: string;
  question: number | null;
  questionsPerPage: number;
}) {
  const session = useSession(),
    authenticated = session.phase === "authenticated",
    canvas = useRef<HTMLCanvasElement>(null);
  const [index, setIndex] = useState(0),
    [overlay, setOverlay] = useState(true),
    [url, setURL] = useState(""),
    [error, setError] = useState("");
  const ids = result.sourceTransforms?.length
      ? result.sourceTransforms.map((t) => t.objectId)
      : result.scanIds || [],
    id = ids[index];
  useEffect(() => {
    let alive = true,
      objectURL = "";
    setURL("");
    setError("");
    if (!id) return;
    void (async () => {
      try {
        let blob: Blob | undefined;
        if (id.startsWith("local-"))
          blob = await (
            await import("./scanArchive")
          ).localOriginal(id, authenticated);
        else {
          if (session.offline)
            throw new Error(
              "This original is stored on the server. Reconnect to inspect it; offline-captured originals remain in your encrypted vault.",
            );
          const response = await fetch(
            `${API_BASE}/schools/${school}/objects/${encodeURIComponent(id)}`,
            {
              cache: "no-store",
              credentials: "include",
              headers: { "X-Markly-Request": "1" },
            },
          );
          if (!response.ok) {
            if (response.status === 401)
              window.dispatchEvent(new Event("omr-session-expired"));
            throw new Error(
              (await response.json().catch(() => ({}))).error ||
                "The original is not available to this account.",
            );
          }
          blob = await response.blob();
        }
        if (!blob)
          throw new Error(
            "The retained original is missing or its encrypted vault is locked.",
          );
        objectURL = URL.createObjectURL(blob);
        if (alive) setURL(objectURL);
        else URL.revokeObjectURL(objectURL);
      } catch (e) {
        if (alive)
          setError(
            e instanceof Error ? e.message : "Cannot open original image.",
          );
      }
    })();
    return () => {
      alive = false;
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [id, school, authenticated, session.offline]);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    const image = new window.Image();
    image.onload = () => {
      const node = canvas.current;
      if (!node || !alive) return;
      const scale = Math.min(
        1,
        1600 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      node.width = Math.round(image.naturalWidth * scale);
      node.height = Math.round(image.naturalHeight * scale);
      const ctx = node.getContext("2d")!;
      ctx.drawImage(image, 0, 0, node.width, node.height);
      if (!overlay) return;
      const page =
        result.sourceTransforms?.find((t) => t.objectId === id)?.pageIndex ??
        index;
      const per = questionsPerPage;
      const matching = result.answerMeta?.filter(
        (m) => m.question >= page * per && m.question < (page + 1) * per,
      );
      for (const meta of matching || []) {
        if (question !== null && meta.question !== question) continue;
        for (const p of meta.coordinates) {
          if (p.x === undefined || p.y === undefined) continue;
          ctx.beginPath();
          ctx.arc(
            p.x * scale,
            p.y * scale,
            (p.radius || 15) * scale + 3,
            0,
            Math.PI * 2,
          );
          ctx.strokeStyle = meta.verified
            ? "#00774a"
            : ["filled", "blank"].includes(meta.status)
              ? "#1969ff"
              : "#e58505";
          ctx.lineWidth = question === meta.question ? 4 : 2;
          ctx.stroke();
        }
      }
    };
    image.onerror = () => {
      if (alive) setError("The retained image could not be decoded.");
    };
    image.src = url;
    return () => {
      alive = false;
      image.onload = null;
      image.onerror = null;
    };
  }, [url, overlay, question, result, id, index, questionsPerPage]);
  const history = useQuery<{
    evaluations: {
      id?: string;
      keyVersion: number;
      createdAt?: string;
      outcome: { score: number; percentage: number; status: string };
    }[];
  }>({
    queryKey: [
      "result-history",
      session.user?.id,
      school,
      result.id,
      result.createdAt,
    ],
    queryFn: async () => {
      return api(`/schools/${school}/results/${result.id}/history`);
    },
    enabled: authenticated && session.backend === "fastapi" && !session.offline,
  });
  return (
    <section className="scan-evidence">
      <div className="row-actions">
        <h3>
          <Image size={17} />
          Original-image evidence
        </h3>
        {ids.length > 1 && (
          <Select
            aria-label="Evidence image"
            value={index}
            onChange={(e) => setIndex(+e.target.value)}
          >
            {ids.map((v, i) => (
              <option value={i} key={v}>
                Page {(result.sourceTransforms?.[i]?.pageIndex ?? i) + 1}
              </option>
            ))}
          </Select>
        )}
        {id && (
          <button className="text-button" onClick={() => setOverlay((v) => !v)}>
            <Layers3 size={14} />
            {overlay
              ? "Hide measured coordinates"
              : "Show measured coordinates"}
          </button>
        )}
      </div>
      {!id ? (
        <p className="small muted">
          This older/imported record does not have a retained original. New
          scans retain the uploaded pixels; detection is never reconstructed
          from an answer key.
        </p>
      ) : error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : !url ? (
        <p>
          <LoaderCircle className="spinning" size={17} />
          Opening retained original…
        </p>
      ) : (
        <div className="evidence-viewport">
          <canvas
            ref={canvas}
            aria-label="Original answer sheet with optional measured bubble coordinates"
          />
        </div>
      )}
      {question !== null &&
        result.answerMeta?.find((m) => m.question === question) && (
          <p className="small muted">
            Question {question + 1} ·{" "}
            {result.answerMeta.find((m) => m.question === question)!.status} ·{" "}
            {result.answerMeta
              .find((m) => m.question === question)!
              .confidence?.toFixed(1)}
            % measured confidence ·{" "}
            {result.answerMeta.find((m) => m.question === question)!.verified
              ? "human verified"
              : "not human verified"}
          </p>
        )}
      {history.error && (
        <p className="form-error">
          Evaluation history: {history.error.message}
        </p>
      )}
      {history.data && (
        <details className="evaluation-history">
          <summary>
            {history.data.evaluations.length} retained evaluation versions
          </summary>
          {history.data.evaluations.map((e, i) => (
            <p key={e.id || i}>
              <strong>
                Key v{e.keyVersion} · {e.outcome.score} marks ·{" "}
                {e.outcome.status}
              </strong>
              <span>
                {e.createdAt
                  ? new Date(e.createdAt).toLocaleString()
                  : "Current published evaluation"}
              </span>
            </p>
          ))}
        </details>
      )}
    </section>
  );
}
