#!/usr/bin/env node

/**
 * scripts/apply-getonbrd.mjs
 * Interactive application assistant for Get on Board jobs via visible Camoufox.
 * 
 * Protocol:
 * 1. Checks job liveness & closed signals.
 * 2. Uploads the correct specialized CV based on job archetype & language.
 * 3. Prompts for questions on stdin:
 *    Pregunta: <texto>
 *    Respuesta: <usuario escribe>
 * 4. Fills the form in Camoufox.
 * 5. Stops before submission, leaving the final submit button visible for the candidate.
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
    usage: 'node scripts/apply-getonbrd.mjs <url> [--cv <path>]'
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
      timeout: 35000,
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
  console.log(`[Get on Board] Abriendo vacante en Camoufox: ${url}`);
  runCamoufox('open', url);
  await sleep(3000);

  // Check closed status
  const pageInfo = JSON.parse(evaluate(`() => {
    const body = document.body.innerText;
    const isClosed = body.includes('Este empleo ya no está disponible') ||
                     body.includes('Este empleo ya no acepta postulaciones') ||
                     body.includes('Esta oferta de trabajo ha expirado') ||
                     body.includes('Página no encontrada') ||
                     document.title.includes('404');
    
    const titleEl = document.querySelector('h1.gb-landing-hero__title, h1');
    const companyEl = document.querySelector('.gb-landing-hero__company, .company_name, [data-company]');
    const descEl = document.querySelector('#job-body, .job-body, .gb-rich-txt');

    const applyBtn = document.querySelector('a[href*=\"/apply\"], button[data-action*=\"apply\"], #apply-button, a[href=\"#apply\"]');

    return JSON.stringify({
      title: titleEl ? titleEl.innerText.trim() : document.title,
      company: companyEl ? companyEl.innerText.trim() : '',
      description: descEl ? descEl.innerText.slice(0, 1000) : '',
      isClosed,
      hasApplyBtn: !!applyBtn
    });
  }`));

  console.log(`[Cargo] ${pageInfo.title}`);
  if (pageInfo.company) console.log(`[Empresa] ${pageInfo.company}`);

  if (pageInfo.isClosed) {
    console.log(`[Estado] ⛔ Vacante cerrada o no disponible en Get on Board.`);
    process.exit(0);
  }

  const targetCv = selectCvPath(pageInfo.title, pageInfo.description);
  console.log(`[CV Router] CV asignado: ${targetCv.replace(process.cwd() + '/', '')}`);

  // Navigate to application form
  evaluate(`() => {
    const applyBtn = document.querySelector('a[href*=\"/apply\"], button[data-action*=\"apply\"], #apply-button, a[href=\"#apply\"]');
    if (applyBtn) applyBtn.click();
  }`);
  await sleep(2000);

  // Upload CV if file input exists
  if (existsSync(targetCv)) {
    console.log(`[Paso CV] Subiendo archivo de CV especializado: ${targetCv}`);
    try {
      runCamoufox('upload', 'input[type="file"]', targetCv);
      await sleep(1500);
    } catch (e) {
      console.log(`[Paso CV] ${e.message}`);
    }
  }

  // Detect form questions
  const formData = JSON.parse(evaluate(`() => {
    const form = document.querySelector('form#new_application, form.application_form, form');
    if (!form) return JSON.stringify({ inForm: false });

    // Text inputs and textareas
    const fields = Array.from(form.querySelectorAll('input[type=\"text\"], input[type=\"number\"], textarea')).map(el => {
      const label = document.querySelector(\`label[for=\"\${el.id}\"]\`) || el.closest('.form-group')?.querySelector('label');
      return {
        id: el.id,
        name: el.name,
        label: label ? label.innerText.trim() : (el.placeholder || el.name),
        value: el.value,
        tag: el.tagName
      };
    }).filter(f => f.label && !f.label.toLowerCase().includes('buscar'));

    // Selects
    const selects = Array.from(form.querySelectorAll('select')).map(s => {
      const label = document.querySelector(\`label[for=\"\${s.id}\"]\`) || s.closest('.form-group')?.querySelector('label');
      return {
        id: s.id,
        name: s.name,
        label: label ? label.innerText.trim() : s.name,
        options: Array.from(s.options).map(o => o.text.trim()),
        value: s.value
      };
    });

    return JSON.stringify({ inForm: true, fields, selects });
  }`));

  if (!formData.inForm) {
    console.log(`[Estado] No se detectó formulario de postulación directo.`);
    process.exit(1);
  }

  // Handle selects
  for (const s of formData.selects) {
    if (!s.value) {
      console.log(`\nPregunta: ${s.label}`);
      console.log(`Opciones disponibles: ${s.options.slice(0, 6).join(' | ')}`);
      const ans = await askUser('Respuesta: ');
      evaluate(`() => {
        const sel = document.getElementById('${s.id}') || document.querySelector('[name=\"${s.name}\"]');
        if (sel) {
          for (const o of sel.options) {
            if (o.text.toLowerCase().includes(\`${ans.toLowerCase()}\`)) {
              sel.value = o.value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
              break;
            }
          }
        }
      }`);
    }
  }

  // Handle fields
  for (const f of formData.fields) {
    if (!f.value || f.value === '') {
      console.log(`\nPregunta: ${f.label}`);
      const ans = await askUser('Respuesta: ');
      evaluate(`() => {
        const el = document.getElementById('${f.id}') || document.querySelector('[name=\"${f.name}\"]');
        if (el) {
          el.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set ||
                         Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
          if (setter) setter.call(el, \`${ans}\`);
          else el.value = \`${ans}\`;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur();
        }
      }`);
    }
  }

  console.log(`\n======================================================`);
  console.log(`[Listo para enviar] Formulario de Get on Board completado en Camoufox.`);
  console.log(`Revisa la pantalla visible y presiona "Enviar postulación".`);
  console.log(`======================================================\n`);
  runCamoufox('screenshot');
}

main();
