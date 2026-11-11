// Écran Employés : liste, recherche, création, modification, désactivation.
import {
  afficherMessage, afficherPagination, api, badge, creer, differer, ecrireFiltresAdresse, ligneVide,
  lireFiltresAdresse, ouvrirFormulaire,
} from './app.js';
import { initialiserEntete } from './entete.js';

await initialiserEntete();

const filtres = document.getElementById('filtres');
const lignes = document.getElementById('lignes');
let page = 1;
let services = [];
let sites = [];

const initiaux = lireFiltresAdresse();
filtres.elements.q.value = initiaux.q ?? '';
filtres.elements.actif.value = initiaux.actif ?? 'oui';
page = Number(initiaux.page) || 1;

async function chargerReferentiels() {
  [services, sites] = await Promise.all([
    api('/referentiels/services').then((r) => r.services),
    api('/referentiels/sites').then((r) => r.sites),
  ]);
  for (const service of services.filter((s) => s.actif)) {
    filtres.elements.service_id.append(creer('option', { value: String(service.id), textContent: service.nom }));
  }
  filtres.elements.service_id.value = initiaux.service_id ?? '';
}

async function charger() {
  const valeurs = {
    q: filtres.elements.q.value.trim(),
    service_id: filtres.elements.service_id.value,
    actif: filtres.elements.actif.value,
    page: page > 1 ? page : '',
  };
  const parametres = ecrireFiltresAdresse(valeurs);
  const reponse = await api(`/employes?${parametres}`);
  lignes.replaceChildren(...(reponse.employes.length
    ? reponse.employes.map(ligne)
    : [ligneVide(8, 'Aucun employé ne correspond.')]));
  afficherPagination(document.getElementById('pagination'), reponse, (cible) => {
    page = cible;
    charger().catch((erreur) => afficherMessage(erreur.message));
  });
}

function ligne(employe) {
  const modifier = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: 'Modifier' });
  modifier.setAttribute('aria-label', `Modifier : ${employe.nom}`);
  modifier.addEventListener('click', () => editer(employe));
  return creer('tr', {},
    creer('td', {}, creer('strong', { textContent: employe.matricule })),
    creer('td', { textContent: [employe.nom, employe.prenoms].filter(Boolean).join(' ') }),
    creer('td', { textContent: employe.fonction ?? '—' }),
    creer('td', { textContent: employe.service ?? '—' }),
    creer('td', { textContent: employe.site ?? '—' }),
    creer('td', { textContent: String(employe.nb_affectations_en_cours) }),
    creer('td', {}, employe.actif ? badge('Active', 'badge-succes') : badge('Désactivée', 'badge-neutre')),
    creer('td', {}, creer('div', { className: 'actions-ligne' }, modifier)));
}

async function editer(employe = null) {
  const actifs = (liste, courant) => liste.filter((e) => e.actif || e.id === courant).map((e) => ({ valeur: e.id, libelle: e.nom }));
  const resultat = await ouvrirFormulaire({
    titre: employe ? `Modifier : ${employe.nom}` : 'Nouvel employé',
    valeurs: employe ?? {},
    libelle: employe ? 'Enregistrer' : 'Créer la fiche',
    champs: [
      { nom: 'matricule', libelle: 'Matricule', obligatoire: true, max: 30, majuscules: true },
      { nom: 'nom', libelle: 'Nom', obligatoire: true, max: 100 },
      { nom: 'prenoms', libelle: 'Prénoms', max: 100 },
      { nom: 'fonction', libelle: 'Fonction', max: 100 },
      { nom: 'service_id', libelle: 'Service', type: 'liste', vide: 'Aucun', options: actifs(services, employe?.service_id) },
      { nom: 'site_id', libelle: 'Site', type: 'liste', vide: 'Aucun', options: actifs(sites, employe?.site_id) },
      { nom: 'telephone', libelle: 'Téléphone', max: 30 },
      { nom: 'email', libelle: 'Adresse e-mail', type: 'email', max: 200 },
      employe && {
        nom: 'actif', libelle: 'Fiche active', type: 'case',
        aide: 'Décochez au départ de l’employé (refusé tant qu’il a des matériels en sa possession).',
      },
    ].filter(Boolean),
    envoyer: (valeurs) => (employe
      ? api(`/employes/${employe.id}`, { methode: 'PATCH', corps: valeurs })
      : api('/employes', { methode: 'POST', corps: valeurs })),
  });
  if (!resultat) return;
  afficherMessage(employe ? 'Fiche modifiée.' : 'Fiche créée.', 'succes');
  await charger();
}

const recharger = () => {
  page = 1;
  charger().catch((erreur) => afficherMessage(erreur.message));
};
filtres.addEventListener('submit', (evenement) => evenement.preventDefault());
filtres.elements.q.addEventListener('input', differer(recharger));
filtres.elements.service_id.addEventListener('change', recharger);
filtres.elements.actif.addEventListener('change', recharger);
document.getElementById('nouveau').addEventListener('click', () => editer());

await chargerReferentiels().catch((erreur) => afficherMessage(erreur.message));
charger().catch((erreur) => afficherMessage(erreur.message));
