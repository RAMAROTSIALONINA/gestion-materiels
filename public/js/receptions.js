// Transferts en route à réceptionner. Le responsable de service ne voit que
// ceux qui arrivent au site de son service.
import { afficherMessage, api, badge, creer, formaterDateCourte, formaterNombre } from './app.js';
import { initialiserEntete } from './entete.js';
import { ouvrirReception } from './reception.js';

const utilisateur = await initialiserEntete();
const conteneur = document.getElementById('transferts');

if (utilisateur.role === 'RESPONSABLE_SERVICE') {
  document.getElementById('aide').textContent = 'Transferts qui arrivent au site de votre service. '
    + 'À l’arrivée, confirmez ce qui est arrivé : le stock et les matériels passent alors à votre site.';
}

function carteTransfert(t) {
  const recevoir = creer('button', { type: 'button', className: 'bouton', textContent: 'Réceptionner' });
  recevoir.addEventListener('click', async () => {
    try {
      const recu = await ouvrirReception(t);
      if (!recu) return;
      afficherMessage(`${t.reference} reçu.`, 'succes');
      await charger();
    } catch (erreur) {
      afficherMessage(erreur.message);
    }
  });
  const attente = t.jours_en_route === 0 ? 'envoyé aujourd’hui' : `en route depuis ${t.jours_en_route} jour${t.jours_en_route > 1 ? 's' : ''}`;
  return creer('section', { className: 'carte' },
    creer('div', { className: 'carte-titre' },
      creer('div', {},
        creer('h2', {}, creer('a', { href: `/mouvements/${t.id}`, textContent: t.reference }), ` · ${t.site_origine} → ${t.site_destination}`),
        creer('div', { className: 'secondaire', textContent: `Envoyé le ${formaterDateCourte(t.date_envoi)} par ${t.envoye_par}${t.numero_ticket ? ` · ticket ${t.numero_ticket}` : ''}` })),
      creer('div', { className: 'actions-ligne' },
        badge(attente, t.jours_en_route > 3 ? 'badge-attente' : 'badge-info'),
        recevoir)),
    t.motif && creer('p', { className: 'secondaire', textContent: `Motif : ${t.motif}` }),
    creer('div', { className: 'tableau-conteneur' }, creer('table', { className: 'tableau' },
      creer('thead', {}, creer('tr', {},
        creer('th', { scope: 'col', textContent: 'Code' }),
        creer('th', { scope: 'col', textContent: 'Désignation' }),
        creer('th', { scope: 'col', className: 'nombre', textContent: 'Envoyé' }))),
      creer('tbody', {}, ...t.lignes.map((ligne) => creer('tr', {},
        creer('td', {}, creer('strong', { textContent: ligne.code })),
        creer('td', { textContent: ligne.designation }),
        creer('td', {
          className: 'nombre',
          textContent: ligne.nature === 'MATERIEL' ? '1' : `${formaterNombre(ligne.quantite, ligne.decimales)} ${ligne.symbole ?? ''}`,
        })))))));
}

async function charger() {
  const { transferts } = await api('/receptions');
  conteneur.replaceChildren(...(transferts.length
    ? transferts.map(carteTransfert)
    : [creer('div', { className: 'carte' }, creer('p', { className: 'secondaire', textContent: 'Aucun transfert en attente de réception.' }))]));
}

charger().catch((erreur) => {
  afficherMessage(erreur.message);
  conteneur.replaceChildren(creer('p', { className: 'secondaire', textContent: 'Chargement impossible.' }));
});
