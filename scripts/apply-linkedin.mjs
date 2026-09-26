#!/usr/bin/env node

/**
 * scripts/apply-linkedin.mjs
 * Interactive application assistant for LinkedIn Easy Apply via visible Camoufox.
 * 
 * Protocol:
 * 1. Checks job liveness & closed signals.
 * 2. Uploads the correct specialized CV based on job archetype & language.
 * 3. Prompts for questions on stdin:
 *    Pregunta: <texto>
 *    Respuesta: <usuario escribe>
 * 4. Navigates steps to the final review screen ("Revisar / Enviar solicitud").
 * 5. Stops before submission.
 */

import { execFileSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import readline from 'readline';

const argv = process.argv.slice(2);
const url = argv.find(a => a.startsWith('http'));

if (!url) {
  console.error(JSON.stringify({
    error: 'Missing job URL operand',
    usage: 'node scripts/apply-linkedin.mjs <url> [--cv <path>]'
  }));
  process.exit(1);
}

const customCv = argv.find((a, i) => argv[i - 1] === '--cv');

const screenshotsDir = join(process.cwd(), 'screenshots');
if (!existsSync(screenshotsDir)) {
  mkdirSync(screenshotsDir, { recursive: true });
}

function runCamoufox(cmd, ...args) {
  try {
    const stdout = execFileSync('camoufox-browser', [cmd, ...args], {
      timeout: 30000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return stdout ? stdout.trim() : '';
  } catch (err) {
    throw new Error(`camoufox-browser ${cmd} failed: ${err.stderr || err.message}`);
  }
}

function evaluate(jsCode) {
  return runCamoufox('evaluate', jsCode);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function askUser(questionPrompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(questionPrompt, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function selectCvPath(jobTitle, jobDescription) {
  if (customCv && existsSync(customCv)) {
    return customCv;
  }
  const text = (jobTitle + ' ' + jobDescription).toLowerCase();
  const isEn = !text.includes('experiencia') && !text.includes('requisitos') &&
               (text.includes('experience') || text.includes('requirements') || text.includes('developer'));
  const l = isEn ? 'en' : 'es';

  if (text.includes('data') || text.includes('datos') || text.includes('etl') || text.includes('pipeline') || text.includes('bigquery') || text.includes('sql')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_data_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  if (text.includes('ai') || text.includes('ia') || text.includes('inference') || text.includes('llm') || text.includes('machine learning')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_ai-systems_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  if (text.includes('devops') || text.includes('sre') || text.includes('infra') || text.includes('linux') || text.includes('cloud') || text.includes('platform')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_infrastructure_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  if (text.includes('cyber') || text.includes('seguridad') || text.includes('security') || text.includes('redes') || text.includes('telecom')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_cybersecurity_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  if (text.includes('sdr') || text.includes('investig') || text.includes('research') || text.includes('scholarship')) {
    const p = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_research-scholarship_${l}.pdf`);
    if (existsSync(p)) return p;
  }
  const backendCv = join(process.cwd(), `documents/cv/ignacio_vicente_zamora_marambio_backend_${l}.pdf`);
  if (existsSync(backendCv)) return backendCv;
  return join(process.cwd(), `documents/cv/cv_${l}_ATS.pdf`);
}

async function main() {
  console.log(`[LinkedIn] Abriendo vacante en Camoufox: ${url}`);
  runCamoufox('open', url);
  await sleep(3000);

  // 1. Check page status
  const pageInfo = JSON.parse(evaluate(`() => {
    const text = document.body.innerText;
    const isClosed = text.includes('No se aceptan solicitudes') || 
                     text.includes('Ya no se aceptan solicitudes') ||
                     text.includes('Este empleo está cerrado');
    
    const titleEl = document.querySelector('h1, .job-details-jobs-unified-top-card__job-title, [class*=\"topcard__title\"]');
    const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, [class*=\"topcard__org-name\"]');
    const descEl = document.querySelector('.jobs-description, #job-details, .description__text');
    
    const easyApplyBtn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = b.innerText.trim();
      return t === 'Solicitud sencilla' || t === 'Easy Apply' || t.includes('Solicitud sencilla');
    });

    const externalApplyLink = Array.from(document.querySelectorAll('a, button')).find(e => {
      const t = e.innerText.trim();
      return t === 'Solicitar' || t.startsWith('Solicitar') || t === 'Apply';
    });

    return JSON.stringify({
      title: titleEl ? titleEl.innerText.trim() : document.title,
      company: companyEl ? companyEl.innerText.trim() : '',
      description: descEl ? descEl.innerText.slice(0, 1000) : '',
      isClosed,
      hasEasyApply: !!easyApplyBtn,
      hasExternalApply: !!externalApplyLink,
      externalHref: externalApplyLink ? (externalApplyLink.href || externalApplyLink.getAttribute('data-href')) : null
    });
  }`));

  console.log(`[Cargo] ${pageInfo.title}`);
  if (pageInfo.company) console.log(`[Empresa] ${pageInfo.company}`);

  if (pageInfo.isClosed) {
    console.log(`[Estado] ⛔ Vacante cerrada (No se aceptan solicitudes).`);
    process.exit(0);
  }

  if (!pageInfo.hasEasyApply && pageInfo.hasExternalApply) {
    console.log(`[Estado] ↗ Postulación externa requerida: ${pageInfo.externalHref}`);
    process.exit(0);
  }

  if (!pageInfo.hasEasyApply) {
    console.log(`[Estado] ⚠️ No se detectó botón de Solicitud sencilla.`);
    process.exit(1);
  }

  // Determine correct CV to upload
  const targetCv = selectCvPath(pageInfo.title, pageInfo.description);
  console.log(`[CV Router] CV asignado: ${targetCv.replace(process.cwd() + '/', '')}`);

  // Click Solicitud sencilla
  console.log(`[Acción] Iniciando Solicitud sencilla...`);
  evaluate(`() => {
    const btn = Array.from(document.querySelectorAll('button')).find(b => {
      const t = b.innerText.trim();
      return t === 'Solicitud sencilla' || t.includes('Solicitud sencilla');
    });
    if (btn) btn.click();
  }`);
  await sleep(2000);

  // Walk through modal steps (up to 8 steps)
  for (let step = 1; step <= 8; step++) {
    const modal = JSON.parse(evaluate(`() => {
      const modalEl = Array.from(document.querySelectorAll('div, section')).find(e => {
        const t = e.innerText || '';
        return t.includes('Aplicar a ') || t.includes('Easy Apply') || t.includes('página');
      });
      if (!modalEl) return JSON.stringify({ open: false });

      const text = modalEl.innerText;
      const isReview = text.includes('Revisar tu solicitud') || 
                       Array.from(document.querySelectorAll('button')).some(b => b.innerText.trim() === 'Enviar solicitud');
      
      const isCvStep = text.includes('Currículum') || text.includes('Resume') || !!modalEl.querySelector('input[type=\"file\"]');

      // Detect question groupings
      const textInputs = Array.from(modalEl.querySelectorAll('input[type=\"text\"], input[type=\"number\"], input:not([type]), textarea')).map(inp => {
        let p = inp.parentElement;
        let label = '';
        for (let k = 0; k < 5 && p; k++) {
          if (p.innerText && p.innerText.trim().length > label.length && !p.innerText.includes('/20')) {
            label = p.innerText.trim();
          }
          p = p.parentElement;
        }
        return {
          id: inp.id,
          label: label.split('\\n')[0].trim(),
          type: inp.tagName === 'TEXTAREA' ? 'textarea' : (inp.type || 'text'),
          value: inp.value,
          maxLength: inp.maxLength
        };
      }).filter(i => i.label && !i.label.toLowerCase().includes('buscar') && !i.label.toLowerCase().includes('notificaciones'));

      // Detect radio button groups
      const fieldsets = Array.from(modalEl.querySelectorAll('fieldset')).map((fs, idx) => {
        const legend = fs.querySelector('legend')?.innerText?.trim() || 'Pregunta de opciones';
        const radios = Array.from(fs.querySelectorAll('input[type=\"radio\"]')).map(r => {
          const lbl = fs.querySelector(\`label[for=\"\${r.id}\"]\`) || r.parentElement;
          return {
            id: r.id,
            label: lbl ? lbl.innerText.trim() : r.value,
            checked: r.checked
          };
        });
        return { legend, radios, idx };
      }).filter(fs => fs.radios.length > 0);

      // Detect select dropdowns
      const selects = Array.from(modalEl.querySelectorAll('select')).map(s => {
        let p = s.parentElement;
        let label = '';
        for (let k = 0; k < 4 && p; k++) {
          if (p.innerText && p.innerText.trim().length > label.length) {
            label = p.innerText.trim();
          }
          p = p.parentElement;
        }
        const options = Array.from(s.options).map(o => o.text.trim());
        return {
          id: s.id,
          label: label.split('\\n')[0].trim(),
          options,
          value: s.value
        };
      }).filter(s => !s.label.toLowerCase().includes('idioma') && !s.label.toLowerCase().includes('código'));

      return JSON.stringify({
        open: true,
        isReview,
        isCvStep,
        textInputs,
        fieldsets,
        selects
      });
    }`));

    if (!modal.open) {
      console.log(`[Modal] No se detecta modal abierto.`);
      break;
    }

    if (modal.isReview) {
      console.log(`\n======================================================`);
      console.log(`[Listo para enviar] Formulario completado en Camoufox.`);
      console.log(`Revisa la pantalla visible y presiona "Enviar solicitud".`);
      console.log(`======================================================\n`);
      runCamoufox('screenshot');
      break;
    }

    // Handle CV step
    if (modal.isCvStep && existsSync(targetCv)) {
      console.log(`[Paso CV] Cargando archivo de CV especializado: ${targetCv}`);
      try {
        runCamoufox('upload', 'input[type="file"]', targetCv);
        await sleep(1500);
      } catch (uploadErr) {
        console.log(`[Paso CV] Nota sobre carga: ${uploadErr.message}`);
      }
    }

    // Handle fieldsets (radio buttons)
    if (modal.fieldsets && modal.fieldsets.length > 0) {
      for (const fs of modal.fieldsets) {
        const unchecked = fs.radios.every(r => !r.checked);
        if (unchecked) {
          console.log(`\nPregunta: ${fs.legend}`);
          console.log(`Opciones disponibles: ${fs.radios.map(r => r.label).join(' | ')}`);
          const ans = await askUser('Respuesta: ');
          
          // Click matching radio in Camoufox
          evaluate(`() => {
            const fs = Array.from(document.querySelectorAll('fieldset')).find(f => {
              const leg = f.querySelector('legend')?.innerText || '';
              return leg.includes(\`${fs.legend.slice(0, 30)}\`);
            });
            if (!fs) return 'fieldset not found';
            const radios = Array.from(fs.querySelectorAll('input[type=\"radio\"]'));
            for (const r of radios) {
              const lbl = fs.querySelector(\`label[for=\"\${r.id}\"]\`) || r.parentElement;
              const text = (lbl ? lbl.innerText : r.value).toLowerCase();
              if (text.includes(\`${ans.toLowerCase()}\`)) {
                r.click();
                r.dispatchEvent(new Event('change', { bubbles: true }));
                return 'checked ' + text;
              }
            }
            return 'no match';
          }`);
          await sleep(500);
        }
      }
    }

    // Handle selects
    if (modal.selects && modal.selects.length > 0) {
      for (const sel of modal.selects) {
        if (!sel.value) {
          console.log(`\nPregunta: ${sel.label}`);
          console.log(`Opciones disponibles: ${sel.options.slice(0, 6).join(' | ')}`);
          const ans = await askUser('Respuesta: ');
          
          evaluate(`() => {
            const s = document.getElementById('${sel.id}');
            if (!s) return 'select not found';
            for (const opt of s.options) {
              if (opt.text.toLowerCase().includes(\`${ans.toLowerCase()}\`)) {
                s.value = opt.value;
                s.dispatchEvent(new Event('change', { bubbles: true }));
                return 'selected ' + opt.text;
              }
            }
            return 'no match';
          }`);
          await sleep(500);
        }
      }
    }

    // Handle text inputs
    if (modal.textInputs && modal.textInputs.length > 0) {
      for (const inp of modal.textInputs) {
        if (!inp.value || inp.value === '') {
          console.log(`\nPregunta: ${inp.label}`);
          const ans = await askUser('Respuesta: ');
          
          evaluate(`() => {
            const el = document.getElementById('${inp.id}');
            if (el) {
              el.focus();
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
              setter.call(el, \`${ans}\`);
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.blur();
              return 'filled';
            }
            return 'not found';
          }`);
          await sleep(500);
        }
      }
    }

    // Advance to next step
    evaluate(`() => {
      const nextBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const t = b.innerText.trim();
        return t === 'Siguiente' || t === 'Next' || t === 'Revisar';
      });
      if (nextBtn) nextBtn.click();
    }`);
    await sleep(2000);
  }
}

main();
