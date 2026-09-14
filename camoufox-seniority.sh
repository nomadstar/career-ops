#!/usr/bin/env bash
set -uo pipefail

input="${1:-/tmp/notion-active-to-audit.tsv}"
output="${2:-/tmp/notion-seniority-results.jsonl}"
delay="0.25"
camoufox_bin="${CAMOUFOX_BROWSER_BIN:-camoufox-browser}"

if [[ ! -f "$input" ]]; then
  printf 'Input file not found: %s\n' "$input" >&2
  exit 1
fi

seniority_js='() => {
  const raw = document.body?.innerText || "";
  const text = raw.toLowerCase();
  const title = (document.title || "").toLowerCase();

  // 1. Get on Board explicit metadata line
  let gobSeniority = null;
  const rawLines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of rawLines) {
    if (line.includes("| Full time") || line.includes("| Part time") || line.includes("| Freelance") || line.includes("| Temporal")) {
      const parts = line.split("|").map(p => p.trim());
      for (const p of parts) {
        if (/^(no experience|sin experiencia|entry|trainee|junior|semi senior|semi-senior|senior|expert|lead)$/i.test(p)) {
          gobSeniority = p;
          break;
        }
      }
    }
    if (gobSeniority) break;
  }

  // 2. Title keywords
  let titleSeniority = null;
  if (/\b(junior|jr\.?|trainee|practicante|pasant[ií]a|reci[eé]n egresad[oa]|reci[eé]n titulad[oa]|entry|graduate)\b/i.test(title)) {
    titleSeniority = "Junior";
  } else if (/\b(senior|sr\.?|lead|principal|staff|arquitecto|architect)\b/i.test(title)) {
    titleSeniority = "Senior";
  } else if (/\b(semi[- ]?senior|ssr\.?|mid[- ]?level|intermedio)\b/i.test(title)) {
    titleSeniority = "Semi-Senior";
  }

  // 3. Scan years of experience
  const expSnippets = [];
  const expRegex = /(?:al menos|m[ií]nimo|experiencia de|requerid[ao]s?|contar con|poseer)?\s*(\d+)(?:\s*(?:a|-)\s*(\d+))?\s*(?:\+|m[aá]s)?\s*a[ñn]os(?:\s*de\s*experiencia)?/gi;
  let m;
  while ((m = expRegex.exec(raw)) !== null) {
    const num = parseInt(m[1], 10);
    if (num >= 1 && num <= 15) {
      expSnippets.push({ match: m[0].trim(), years: num });
    }
  }

  const maxYears = expSnippets.length > 0 ? Math.max(...expSnippets.map(e => e.years)) : 0;

  // 4. Final classification
  let level = "Indeterminada";
  let feasibleForJunior = true;
  let reason = "";

  if (gobSeniority) {
    const gLower = gobSeniority.toLowerCase();
    if (gLower.includes("senior") && !gLower.includes("semi")) {
      level = "Senior";
      feasibleForJunior = false;
      reason = "Badge Get on Board: " + gobSeniority;
    } else if (gLower.includes("semi senior") || gLower.includes("semi-senior")) {
      level = "Semi-Senior";
      feasibleForJunior = false;
      reason = "Badge Get on Board: " + gobSeniority;
    } else if (gLower.includes("expert") || gLower.includes("lead")) {
      level = "Senior / Expert";
      feasibleForJunior = false;
      reason = "Badge Get on Board: " + gobSeniority;
    } else if (gLower.includes("junior") || gLower.includes("no experience") || gLower.includes("sin experiencia")) {
      level = "Junior";
      feasibleForJunior = true;
      reason = "Badge Get on Board: " + gobSeniority;
    }
  }

  if (level === "Indeterminada" && titleSeniority) {
    level = titleSeniority;
    if (titleSeniority === "Senior") {
      feasibleForJunior = false;
      reason = "Título: Senior";
    } else if (titleSeniority === "Semi-Senior") {
      feasibleForJunior = false;
      reason = "Título: Semi-Senior";
    } else if (titleSeniority === "Junior") {
      feasibleForJunior = true;
      reason = "Título: Junior";
    }
  }

  if (level === "Indeterminada" || level === "Junior") {
    if (maxYears >= 4) {
      level = "Senior (" + maxYears + "+ años)";
      feasibleForJunior = false;
      reason = "Exige " + maxYears + "+ años de exp";
    } else if (maxYears >= 3) {
      level = "Semi-Senior / Senior (3 años)";
      feasibleForJunior = false;
      reason = "Exige al menos " + maxYears + " años de exp";
    } else if (maxYears <= 2 && maxYears > 0) {
      level = "Junior (0-2 años)";
      feasibleForJunior = true;
      reason = "Pide hasta " + maxYears + " años de exp (accesible)";
    }
  }

  if (level === "Indeterminada") {
    if (/sin experiencia|reci[eé]n titulad[oa]|reci[eé]n egresad[oa]/i.test(raw)) {
      level = "Junior (Sin exp previa)";
      feasibleForJunior = true;
      reason = "Menciona sin experiencia o recién titulado";
    } else {
      level = "No especificada";
      feasibleForJunior = true;
      reason = "Sin nivel explícito ni años excluyentes";
    }
  }

  return { title: document.title, gobSeniority, titleSeniority, maxYears, level, feasibleForJunior, reason };
}'

emit() {
  local page_id="$1" source_url="$2" label="$3" result="$4" open_error="$5"
  node -e '
    const [pageId, sourceUrl, label, resultText, openError] = process.argv.slice(1);
    let result;
    try { result = JSON.parse(resultText); }
    catch { result = { level: "Error", feasibleForJunior: true, reason: openError || resultText || "Evaluation failed" }; }
    process.stdout.write(JSON.stringify({ page_id: pageId, url: sourceUrl, label, ...result }) + "\n");
  ' "$page_id" "$source_url" "$label" "$result" "$open_error"
}

run_audit() {
  local page_id url label open_text result
  while IFS=$'\t' read -r page_id url label || [[ -n "${page_id:-}${url:-}${label:-}" ]]; do
    [[ -z "${page_id// }" || "$page_id" == \#* ]] && continue
    if [[ ! "$url" =~ ^https:// ]]; then
      emit "$page_id" "$url" "${label:-}" '' 'Only absolute HTTPS URLs are accepted'
      continue
    fi

    open_text="$(timeout 15 "$camoufox_bin" open "$url" 2>&1)" || {
      emit "$page_id" "$url" "${label:-}" '' "$open_text"
      continue
    }
    sleep "$delay"
    result="$($camoufox_bin evaluate "$seniority_js" 2>&1)" || {
      emit "$page_id" "$url" "${label:-}" '' "$result"
      continue
    }
    emit "$page_id" "$url" "${label:-}" "$result" ''
  done < "$input"
}

run_audit > "$output"
printf 'Wrote seniority audit results to %s\n' "$output" >&2
