#!/usr/bin/env node

/**
 * scripts/apply-job.mjs
 * Master automation script for applying to jobs in Camoufox (visible mode).
 * 
 * Works across LinkedIn, Get on Board, Chiletrabajos, Trabajando.cl, Computrabajo.
 * 
 * Protocol:
 * 1. Opens the job URL in Camoufox.
 * 2. Checks if closed/expired (exits code 2).
 * 3. Finds and clicks the apply button ("Solicitud sencilla", "Postular", etc.).
 * 4. At CV step: uploads the matching specialized CV based on job archetype & language.
 * 5. At each question step: prints questions to stdout, reads answers from stdin, and fills them.
 * 6. Advances steps until the final review screen.
 * 7. Waits for user confirmation (exits code 0 on submitted).
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
    usage: 'node scripts/apply-job.mjs <url> [--cv <path>]'
  }));
  process.exit(1);
}

const customCv = argv.find((a, i) => argv[i - 1] === '--cv');

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
  if (customCv && existsSync(customCv)) return customCv;
  const text = (jobTitle + ' ' + jobDescription).toLowerCase();
  
  // Detect language
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
  console.log(`\n======================================================`);
  console.log(`[Abrir] Navegando a: ${url}`);
  console.log(`======================================================`);
  
  runCamoufox('open', url);
  await sleep(2500);

  // 1. Evaluate page status
  const pageInfo = JSON.parse(evaluate(`() => {
    const body = document.body.innerText;
    const title = document.title;
    
    // Check closed signals across portals
    const isClosed = body.includes('No se aceptan solicitudes') ||
                     body.includes('Ya no se aceptan solicitudes') ||
                     body.includes('Este empleo está cerrado') ||
                     body.includes('Esta oferta no está disponible') ||
                     body.includes('Esta oferta de trabajo ha finalizado') ||
                     body.includes('Esta oferta de empleo ya ha caducado') ||
                     body.includes('El aviso ya finalizó') ||
                     body.includes('Este empleo ya no acepta postulaciones') ||
                     title.includes('404') || body.includes('Página no encontrada');

    const titleEl = document.querySelector('h1, .job-details-jobs-unified-top-card__job-title, .gb-landing-hero__title');
    const companyEl = document.querySelector('.job-details-jobs-unified-top-card__company-name, .gb-landing-hero__company, [class*=\"company\"]');
    const descEl = document.querySelector('.jobs-description, #job-details, #job-body, .description');

    // Detect apply buttons
    const applyButtons = Array.from(document.querySelectorAll('button, a')).filter(el => {
      const t = el.innerText.trim();
      return t === 'Solicitud sencilla' || t.includes('Solicitud sencilla') ||
             t === 'Postular' || t === 'Postularme' || t.includes('Postular') ||
             t === 'Apply' || t === 'Easy Apply' || el.href?.includes('/apply');
    }).map(el => ({
      tag: el.tagName,
      text: el.innerText.trim(),
      href: el.href || null
    }));

    return JSON.stringify({
      title: titleEl ? titleEl.innerText.trim() : title,
      company: companyEl ? companyEl.innerText.trim() : '',
      description: descEl ? descEl.innerText.slice(0, 1500) : '',
      isClosed,
      applyButtons
    });
  }`));

  console.log(`[Cargo] ${pageInfo.title}`);
  if (pageInfo.company) console.log(`[Empresa] ${pageInfo.company}`);

  if (pageInfo.isClosed) {
    console.log(`\n⛔ [ESTADO] Convocatoria CERRADA / Finalizada.`);
    process.exit(2); // Code 2 = Closed
  }

  if (!pageInfo.applyButtons || pageInfo.applyButtons.length === 0) {
    console.log(`\n⚠️ [ESTADO] No se detectó botón de postulación directa.`);
    process.exit(3); // Code 3 = Not found
  }

  // 2. Select CV
  const targetCv = selectCvPath(pageInfo.title, pageInfo.description);
  console.log(`[CV Router] CV especializado asignado: ${targetCv.replace(process.cwd() + '/', '')}`);

  // 3. Click Apply Button
  console.log(`[Acción] Presionando botón de postulación...`);
  evaluate(`() => {
    const btn = Array.from(document.querySelectorAll('button, a')).find(el => {
      const t = el.innerText.trim();
      return t === 'Solicitud sencilla' || t.includes('Solicitud sencilla') ||
             t === 'Postular' || t === 'Postularme' || t.includes('Postular') ||
             t === 'Apply' || t === 'Easy Apply' || el.href?.includes('/apply');
    });
    if (btn) btn.click();
  }`);
  await sleep(2000);

  // 4. Form Steps Loop (up to 8 steps)
  for (let step = 1; step <= 8; step++) {
    // Check if there is a file upload field on this step
    const hasFileInput = evaluate(`() => !!document.querySelector('input[type=\"file\"]')`) === 'true';
    if (hasFileInput && existsSync(targetCv)) {
      console.log(`[Paso CV] Subiendo archivo: ${targetCv.replace(process.cwd() + '/', '')}`);
      try {
        runCamoufox('upload', 'input[type="file"]', targetCv);
        await sleep(1500);
      } catch (e) {
        console.log(`[Paso CV] Info carga: ${e.message}`);
      }
    }

    // Check if we are on the final Review screen
    const isFinalReview = JSON.parse(evaluate(`() => {
      const text = document.body.innerText;
      const submitBtn = Array.from(document.querySelectorAll('button')).find(b => {
        const t = b.innerText.trim();
        return t === 'Enviar solicitud' || t === 'Enviar postulación' || t === 'Confirmar postulación' || t === 'Submit application';
      });
      return JSON.stringify({ isReview: !!submitBtn, btnText: submitBtn ? submitBtn.innerText.trim() : null });
    }`));

    if (isFinalReview.isReview) {
      console.log(`\n======================================================`);
      console.log(`🎉 [LISTO PARA ENVIAR] Formulario completado con éxito.`);
      console.log(`Botón disponible en pantalla: "${isFinalReview.btnText}"`);
      console.log(`Revisa la ventana visible en Camoufox y presiona Enviar.`);
      console.log(`======================================================\n`);
      
      const conf = await askUser('Presiona [Enter] tras presionar Enviar en Camoufox (o escribe "cancelar"): ');
      if (conf.toLowerCase().includes('canc')) {
        console.log(`[Cancelado] Postulación no completada.`);
        process.exit(1);
      }
      console.log(`[Confirmado] Postulación enviada exitosamente.`);
      process.exit(0); // Code 0 = Submitted successfully
    }

    // Inspect unfilled fields on this step
    const stepQuestions = JSON.parse(evaluate(`() => {
      const container = document.querySelector('[role=\"dialog\"], .jobs-easy-apply-modal, form, body');
      
      // Text and Number inputs
      const textInputs = Array.from(container.querySelectorAll('input[type=\"text\"], input[type=\"number\"], input:not([type]), textarea')).filter(el => {
        return el.offsetParent !== null && !el.id.includes('search') && (!el.value || el.value === '');
      }).map(inp => {
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
          name: inp.name,
          label: label.split('\\n')[0].trim(),
          type: inp.tagName === 'TEXTAREA' ? 'textarea' : 'text'
        };
      }).filter(i => i.label && !i.label.toLowerCase().includes('buscar') && !i.label.toLowerCase().includes('notificaciones'));

      // Radio groups
      const fieldsets = Array.from(container.querySelectorAll('fieldset')).filter(fs => {
        const radios = Array.from(fs.querySelectorAll('input[type=\"radio\"]'));
        return radios.length > 0 && radios.every(r => !r.checked);
      }).map(fs => {
        const legend = fs.querySelector('legend')?.innerText?.trim() || 'Pregunta';
        const radios = Array.from(fs.querySelectorAll('input[type=\"radio\"]')).map(r => {
          const lbl = fs.querySelector(\`label[for=\"\${r.id}\"]\`) || r.parentElement;
          return { id: r.id, text: lbl ? lbl.innerText.trim() : r.value };
        });
        return { legend, radios };
      });

      // Select dropdowns
      const selects = Array.from(container.querySelectorAll('select')).filter(s => {
        return s.offsetParent !== null && !s.value;
      }).map(s => {
        let p = s.parentElement;
        let label = '';
        for (let k = 0; k < 4 && p; k++) {
          if (p.innerText && p.innerText.trim().length > label.length) {
            label = p.innerText.trim();
          }
          p = p.parentElement;
        }
        return {
          id: s.id,
          name: s.name,
          label: label.split('\\n')[0].trim(),
          options: Array.from(s.options).map(o => o.text.trim())
        };
      }).filter(s => !s.label.toLowerCase().includes('idioma') && !s.label.toLowerCase().includes('código'));

      return JSON.stringify({ textInputs, fieldsets, selects });
    }`));

    // Answer radio groups
    for (const fs of stepQuestions.fieldsets) {
      console.log(`\nPregunta: ${fs.legend}`);
      console.log(`Opciones disponibles: ${fs.radios.map(r => r.text).join(' | ')}`);
      const ans = await askUser('Respuesta: ');
      
      evaluate(`() => {
        const fs = Array.from(document.querySelectorAll('fieldset')).find(f => {
          const leg = f.querySelector('legend')?.innerText || '';
          return leg.includes(\`${fs.legend.slice(0, 30)}\`);
        });
        if (!fs) return;
        const radios = Array.from(fs.querySelectorAll('input[type=\"radio\"]'));
        for (const r of radios) {
          const lbl = fs.querySelector(\`label[for=\"\${r.id}\"]\`) || r.parentElement;
          const text = (lbl ? lbl.innerText : r.value).toLowerCase();
          if (text.includes(\`${ans.toLowerCase()}\`)) {
            r.click();
            r.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }`);
      await sleep(300);
    }

    // Answer selects
    for (const sel of stepQuestions.selects) {
      console.log(`\nPregunta: ${sel.label}`);
      console.log(`Opciones disponibles: ${sel.options.slice(0, 8).join(' | ')}`);
      const ans = await askUser('Respuesta: ');

      evaluate(`() => {
        const s = document.getElementById('${sel.id}') || document.querySelector('[name=\"${sel.name}\"]');
        if (!s) return;
        for (const opt of s.options) {
          if (opt.text.toLowerCase().includes(\`${ans.toLowerCase()}\`)) {
            s.value = opt.value;
            s.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }`);
      await sleep(300);
    }

    // Answer text inputs
    for (const inp of stepQuestions.textInputs) {
      console.log(`\nPregunta: ${inp.label}`);
      const ans = await askUser('Respuesta: ');

      evaluate(`() => {
        const el = document.getElementById('${inp.id}') || document.querySelector('[name=\"${inp.name}\"]');
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
      await sleep(300);
    }

    // Click Next / Siguiente / Revisar
    const nextSuccess = evaluate(`() => {
      const nextBtn = Array.from(document.querySelectorAll('button, a')).find(b => {
        const t = b.innerText.trim();
        return t === 'Siguiente' || t === 'Next' || t === 'Revisar' || t === 'Continuar' || t === 'Avanzar';
      });
      if (nextBtn) {
        nextBtn.click();
        return 'clicked';
      }
      return 'not found';
    }`);

    await sleep(2000);
  }

  console.log(`[Aviso] Se alcanzaron las iteraciones máximas del formulario.`);
}

main();
