// Étiquettes code-barres (Code 128) des matériels choisis. L'impression est
// notée sur chaque fiche et inscrite au journal.
import { afficherMessage, api, creer } from './app.js';
import { initialiserEntete } from './entete.js';

await initialiserEntete();

const ESPACE_SVG = 'http://www.w3.org/2000/svg';
const ids = (new URLSearchParams(window.location.search).get('ids') ?? '')
  .split(',').map(Number).filter((id) => Number.isSafeInteger(id) && id > 0);
const planche = document.getElementById('planche');
const boutonImprimer = document.getElementById('imprimer');
const champDecalage = document.getElementById('decalage');
let donnees = null;

function etiquette({ code, designation, site_code: site }, societe) {
  const codeBarres = document.createElementNS(ESPACE_SVG, 'svg');
  codeBarres.classList.add('etiquette-code-barres');
  window.JsBarcode(codeBarres, code, {
    format: 'CODE128', displayValue: false, margin: 0, height: 40, width: 1.6, background: '#ffffff', lineColor: '#000000',
  });
  codeBarres.setAttribute('preserveAspectRatio', 'none');
  codeBarres.setAttribute('role', 'img');
  codeBarres.setAttribute('aria-label', `Code-barres ${code}`);
  return creer('div', { className: 'etiquette' },
    creer('div', { className: 'etiquette-haut' },
      creer('span', { className: 'etiquette-societe', textContent: societe && societe !== 'À renseigner' ? societe : '' }),
      creer('span', { className: 'etiquette-site', textContent: site ?? '' })),
    creer('div', { className: 'etiquette-designation', textContent: designation }),
    codeBarres,
    creer('div', { className: 'etiquette-code', textContent: code }));
}

// Une feuille A4 par groupe de 21 étiquettes ; la première peut commencer
// plus loin, pour finir une planche déjà entamée.
const PAR_FEUILLE = 21;
function afficher() {
  const decalage = Math.min(PAR_FEUILLE - 1, Math.max(0, (Number(champDecalage.value) || 1) - 1));
  const cases = [
    ...Array.from({ length: decalage }, () => creer('div', { className: 'etiquette etiquette-vide' })),
    ...donnees.etiquettes.map((ligne) => etiquette(ligne, donnees.societe)),
  ];
  const feuilles = [];
  for (let debut = 0; debut < cases.length; debut += PAR_FEUILLE) {
    feuilles.push(creer('div', { className: 'feuille' }, ...cases.slice(debut, debut + PAR_FEUILLE)));
  }
  planche.replaceChildren(...feuilles);
}

async function charger() {
  if (ids.length === 0) {
    document.getElementById('consigne').textContent = 'Aucun matériel choisi : cochez-les dans la liste des matériels.';
    return;
  }
  if (typeof window.JsBarcode !== 'function') throw new Error('La bibliothèque de code-barres n’a pas pu être chargée.');
  donnees = await api(`/materiels/etiquettes?ids=${ids.join(',')}`);
  afficher();
  boutonImprimer.disabled = donnees.etiquettes.length === 0;
  boutonImprimer.textContent = `Imprimer ${donnees.etiquettes.length} étiquette${donnees.etiquettes.length > 1 ? 's' : ''}`;
}

champDecalage.addEventListener('input', () => donnees && afficher());
boutonImprimer.addEventListener('click', async () => {
  boutonImprimer.disabled = true;
  try {
    await api('/materiels/etiquettes', { methode: 'POST', corps: { ids: donnees.etiquettes.map((ligne) => ligne.id) } });
    window.print();
  } catch (erreur) {
    afficherMessage(erreur.message);
  } finally {
    boutonImprimer.disabled = false;
  }
});

charger().catch((erreur) => afficherMessage(erreur.message));
