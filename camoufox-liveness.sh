#!/usr/bin/env bash
set -uo pipefail

# Fast, visible job-posting liveness checks through camoufox-browser.
#
# Input (TSV, one row per posting):
#   <notion-page-id>\t<url>\t<optional label>
#
# Output (JSONL): one object per row with status active|expired|blocked|unknown.
# This script is deliberately read-only: it never logs in, solves CAPTCHAs,
# clicks Apply/Submit, or updates Notion. A human/agent reviews the JSONL and
# performs the explicit Notion update as a separate step. When a CAPTCHA is
# detected in an interactive terminal, it waits automatically while the human
# solves it in the visible browser, then re-checks before advancing.

usage() {
  printf '%s\n' \
    'Usage: camoufox-liveness.sh --input FILE [--output FILE] [--delay SECONDS]' \
    '' \
    'FILE must be TSV: notion_page_id<TAB>url<TAB>optional label' \
    'Camoufox is always started visibly; this script never uses --headless.'
}

input=''
output=''
delay='0.35'
camoufox_bin="${CAMOUFOX_BROWSER_BIN:-camoufox-browser}"

while (($#)); do
  case "$1" in
    --input)
      input="${2:-}"
      shift 2
      ;;
    --output)
      output="${2:-}"
      shift 2
      ;;
    --delay)
      delay="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$input" || ! -f "$input" ]]; then
  printf 'Input TSV not found: %s\n' "${input:-<missing>}" >&2
  exit 2
fi

if ! command -v "$camoufox_bin" >/dev/null 2>&1; then
  printf 'camoufox-browser was not found. Install it before running this check.\n' >&2
  exit 127
fi

if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js is required to serialize safe JSONL output.\n' >&2
  exit 127
fi

# Starting without flags is intentionally headed/visible. If already running,
# preserve the existing visible session and its cookies.
status_text="$($camoufox_bin status 2>&1 || true)"
if [[ "$status_text" != *'Daemon is running'* ]]; then
  "$camoufox_bin" start
fi

classify_js='() => {
  const raw = document.body?.innerText || "";
  const text = raw.toLowerCase();
  const host = location.hostname.toLowerCase();
  const title = document.title || "";
  const has = (...xs) => xs.some((x) => text.includes(x));

  let status = "unknown";
  let evidence = "No conclusive active/expired marker";

  if (!raw.trim() || !title.trim()) {
    status = "blocked";
    evidence = "Empty page/title (rate limit, navigation block, or incomplete load)";
  } else if (has("captcha", "verify you are human", "verifica que eres humano", "verificación adicional requerida", "security check")) {
    status = "blocked";
    evidence = "Human verification/CAPTCHA required";
  } else if (
    has(
      "tiempo finalizado", "plazo finalizado", "este empleo caducó", "empleo caducó",
      "ya no acepta solicitudes", "no longer accepting applications",
      "job is no longer available", "position has been filled", "oferta finalizada",
      "esta oferta ya no", "no encontramos la página que buscas",
      "the page you were looking for doesn’t exist", "the page you were looking for doesn\u0027t exist",
      "404. we really tried", "404 not found", "página no encontrada", "page not found"
    ) ||
    (host.includes("weworkremotely.com") && (location.pathname === "/" || has("41,994 jobs posted", "the largest job board for remote jobs")))
  ) {
    status = "expired";
    evidence = "Explicit expired/unavailable marker";
  } else if (host.includes("freelancer.")) {
    if (has("\nclosed\n", "\nin progress\n", "bidding has ended", "closed for bidding")) {
      status = "expired";
      evidence = "Freelancer project is Closed/In progress; bidding is unavailable";
    } else if (has("place a bid", "bid on this project", "ofertar")) {
      status = "active";
      evidence = "Freelancer bidding control is visible";
    }
  } else if (
    has(
      "solicitar", "solicitud sencilla", "solicitud fácil", "easy apply",
      "apply now", "postular", "postula ahora", "postularme", "enviar candidatura"
    ) ||
    (host.includes("torre.ai") && has("match y ranking", "responsabilidades", "inicia sesión para descubrir tu match"))
  ) {
    status = "active";
    evidence = "Apply/Postular/Torre control is visible";
  }

  return { status, evidence, title, final_url: location.href };
}'

emit() {
  local page_id="$1" source_url="$2" label="$3" result="$4" open_error="$5"
  node -e '
    const [pageId, sourceUrl, label, resultText, openError] = process.argv.slice(1);
    let result;
    try { result = JSON.parse(resultText); }
    catch { result = { status: "blocked", evidence: openError || resultText || "Camoufox evaluation failed" }; }
    process.stdout.write(JSON.stringify({ page_id: pageId, url: sourceUrl, label, ...result }) + "\n");
  ' "$page_id" "$source_url" "$label" "$result" "$open_error"
}

is_human_verification() {
  local result="$1"
  [[ "$result" == *'"status": "blocked"'* && "$result" == *'Human verification/CAPTCHA required'* ]]
}

evaluate_after_human_verification() {
  local result announced='false'
  while true; do
    result="$($camoufox_bin evaluate "$classify_js" 2>&1)" || {
      printf '%s' "$result"
      return 1
    }
    if ! is_human_verification "$result"; then
      printf '%s' "$result"
      return 0
    fi

    # This function runs inside command substitution, where stdin is not a TTY
    # even when the parent script is interactive. /dev/tty is the reliable
    # signal and channel for the visible human-verification handoff.
    if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then
      # Scheduled/non-interactive runs cannot ask a human. Preserve the blocked
      # classification so the row remains unchanged and can be retried later.
      printf '%s' "$result"
      return 0
    fi

    if [[ "$announced" == 'false' ]]; then
      printf '\nCAPTCHA/verificación humana detectada.\n' >/dev/tty
      printf 'Resuélvela en la ventana visible; el script continuará automáticamente.\n' >/dev/tty
      announced='true'
    fi
    # Use Camoufox's own wait primitive rather than requiring terminal input.
    # Re-check after every interval and advance as soon as verification clears.
    "$camoufox_bin" wait --time 2 >/dev/null 2>&1 || sleep 2
  done
}

run_checks() {
  local page_id url label open_text result
  while IFS=$'\t' read -r page_id url label || [[ -n "${page_id:-}${url:-}${label:-}" ]]; do
    [[ -z "${page_id// }" || "$page_id" == \#* ]] && continue
    if [[ ! "$url" =~ ^https:// ]]; then
      emit "$page_id" "$url" "${label:-}" '' 'Only absolute HTTPS URLs are accepted'
      continue
    fi

    open_text="$(timeout 20 "$camoufox_bin" open "$url" 2>&1)" || {
      emit "$page_id" "$url" "${label:-}" '' "$open_text"
      continue
    }
    sleep "$delay"
    result="$(evaluate_after_human_verification)" || {
      emit "$page_id" "$url" "${label:-}" '' "$result"
      continue
    }
    emit "$page_id" "$url" "${label:-}" "$result" ''
  done < "$input"
}

if [[ -n "$output" ]]; then
  run_checks > "$output"
  printf 'Wrote liveness results to %s\n' "$output" >&2
else
  run_checks
fi
