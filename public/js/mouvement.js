// Fiche d'un mouvement : en-tête, lignes, suivi, et les actions possibles
// (modifier, valider ou autoriser, réceptionner, annuler, mouvement inverse).
import {
  afficherMessage, api, badgesMouvement, confirmer, creer, definitions, formaterDateCourte, formaterDateHeure, formaterNombre,
  ligneVide, ouvrirFormulaire,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';
import { ouvrirReception } from './reception.js';

const utilisateur = await initialiserEntete();
const id = Number(window.location.pathname.split('/').pop());
const element = (nom) => document.getElementById(nom);
const carte = (titre, contenu) => creer('section', { className: 'carte' }, creer('h2', { textContent: titre }), contenu);
const parQui = (quand, qui) => (qui ? `${formaterDateHeure(quand)} par ${qui}` : null);
const bouton = (texte, action, classe = 'bouton') => {
  const b = creer('button', { type: 'button', className: classe, textContent: texte });
  b.addEventListener('click', () => action().catch((erreur) => afficherMessage(erreur.message)));
  return b;
};

// Message laissé par la page de saisie (?valide=1 ou ?enregistre=1).
const retour = new URLSearchParams(window.location.search);
if (retour.has('valide')) afficherMessage('Mouvement enregistré et validé.', 'succes');
if (retour.has('enregistre')) afficherMessage('Brouillon enregistré.', 'succes');
if (retour.size) window.history.replaceState(null, '', window.location.pathname);

function lienBien(ligne) {
  const chemin = ligne.article_id ? `/articles/${ligne.article_id}` : `/materiels/${ligne.materiel_id}`;
  return creer('a', { href: chemin, textContent: ligne.code });
}

function actions(m) {
  const liste = [];
  const saisie = aLeDroit(utilisateur, 'mouvements.saisir');
  const annulation = aLeDroit(utilisateur, 'mouvements.annuler');
  const note = element('note');
  note.hidden = true;

  if (m.statut === 'BROUILLON') {
    if (saisie && m.saisie_manuelle) {
      liste.push(creer('a', { className: 'bouton bouton-secondaire', href: `/mouvements/${m.id}/modifier`, textContent: 'Modifier' }));
    }
    if (annulation) liste.push(bouton('Abandonner', () => annuler(m, true), 'bouton bouton-secondaire'));
    if (m.autorisation_requise) {
      const peutAutoriser = aLeDroit(utilisateur, 'mouvements.autoriser') && (m.cree_par !== utilisateur.id || utilisateur.role === 'ADMIN');
      if (peutAutoriser) liste.push(bouton('Autoriser et valider', () => valider(m, true)));
      note.textContent = peutAutoriser
        ? 'Ce mouvement attend une autorisation : en le validant, vous l’autorisez.'
        : 'Ce mouvement attend une autorisation : un administrateur ou un autre gestionnaire doit le valider.';
      note.hidden = false;
    } else if (saisie) {
      liste.push(bouton('Valider', () => valider(m, false)));
    }
  }

  if (m.statut === 'VALIDE') {
    if (m.etat_transfert === 'EN_ROUTE' && aLeDroit(utilisateur, 'transferts.receptionner')) {
      liste.push(bouton('Réceptionner', () => receptionner(m)));
    }
    const inverseEnCours = (m.corrections ?? []).some((c) => c.statut !== 'ANNULE');
    if (saisie && m.lignes.every((l) => l.article_id) && m.etat_transfert !== 'EN_ROUTE' && !inverseEnCours) {
      liste.push(bouton('Mouvement inverse', () => inverse(m), 'bouton bouton-secondaire'));
    }
    // La base refuse d'annuler un transfert déjà reçu (on passe un transfert
    // inverse) et la réception d'un matériel (on le sort par une mise au rebut).
    const receptionMateriel = m.type_code.startsWith('RECEPTION_') && m.lignes.some((l) => l.materiel_id);
    if (annulation && !m.lie_a_une_affectation && m.etat_transfert !== 'RECU' && !receptionMateriel) {
      liste.push(bouton('Annuler le mouvement', () => annuler(m, false), 'bouton bouton-danger'));
    }
    if (m.lie_a_une_affectation) {
      note.textContent = 'Mouvement créé par une remise ou un retour de matériel : il se gère depuis l’écran Affectations.';
      note.hidden = false;
    }
  }
  element('actions').replaceChildren(...liste);
}

async function charger() {
  const { mouvement: m } = await api(`/mouvements/${id}`);
  document.title = `${m.reference} — Gestion des matériels`;
  element('titre').textContent = `${m.reference} · ${m.type}`;
  element('pastilles').replaceChildren(badgesMouvement(m));
  actions(m);

  const beneficiaire = m.employe_beneficiaire
    ? `${m.employe_beneficiaire} (${m.employe_matricule})`
    : m.service_beneficiaire;
  const corrections = (m.corrections ?? []).flatMap((c, rang) => [
    rang ? ', ' : null, creer('a', { href: `/mouvements/${c.id}`, textContent: c.reference }), c.statut === 'ANNULE' ? ' (annulé)' : null,
  ]);
  element('fiche').replaceChildren(
    carte('Opération', definitions([
      ['Type', m.type],
      ['Date', formaterDateCourte(m.date_mouvement)],
      ['Motif', m.motif],
      ['N° de ticket', m.numero_ticket],
      ['N° de bon ou facture', m.reference_externe],
      ['Fournisseur ou donateur', m.origine],
      ['Bénéficiaire', beneficiaire],
      ['Corrige le mouvement', m.mouvement_corrige_id
        ? creer('a', { href: `/mouvements/${m.mouvement_corrige_id}`, textContent: m.mouvement_corrige_reference })
        : null],
      ['Corrigé par', corrections.length ? creer('span', {}, ...corrections) : null],
    ].filter(([libelle, valeur]) => ['Type', 'Date'].includes(libelle) || (valeur !== null && valeur !== undefined && valeur !== '')))),
    carte('Suivi', definitions([
      ['Saisi', parQui(m.cree_le, m.cree_par_nom)],
      ['Validé', parQui(m.valide_le, m.valide_par_nom)],
      m.autorisation_requise && ['Autorisé par', m.autorise_par_nom],
      m.sens === 'TRANSFERT' && m.statut !== 'BROUILLON' && ['Reçu', m.recu_le
        ? `${formaterDateCourte(m.date_reception)} (saisi ${parQui(m.recu_le, m.recu_par_nom)})`
        : 'En route'],
      m.motif_ecart && ['Motif du manquant', m.motif_ecart],
      m.statut === 'ANNULE' && ['Annulé', parQui(m.annule_le, m.annule_par_nom)],
      m.statut === 'ANNULE' && ['Motif d’annulation', m.motif_annulation],
    ].filter(Boolean))),
  );

  const transfert = m.sens === 'TRANSFERT';
  const brouillon = m.statut === 'BROUILLON';
  element('colonne-recue').hidden = !transfert;
  element('colonne-stock').hidden = !brouillon || m.sens === 'ENTREE';
  const colonnes = 4 + Number(transfert) + Number(brouillon && m.sens !== 'ENTREE');
  const rangees = m.lignes.map((ligne) => {
    const unite = ligne.article_id ? ` ${ligne.symbole}` : '';
    const ecart = transfert && ligne.quantite_recue !== null && ligne.quantite_recue < ligne.quantite;
    const rangee = creer('tr', { className: ecart ? 'ligne-ecart' : '' },
      creer('td', {}, creer('strong', {}, lienBien(ligne))),
      creer('td', {}, creer('div', { textContent: ligne.designation }),
        ligne.observations && creer('div', { className: 'secondaire', textContent: ligne.observations })),
      creer('td', { textContent: [ligne.site_origine, ligne.site_destination].filter(Boolean).join(' → ') || '—' }),
      creer('td', { className: 'nombre', textContent: `${formaterNombre(ligne.quantite, ligne.decimales ?? 0)}${unite}` }));
    if (transfert) {
      rangee.append(creer('td', {
        className: 'nombre',
        textContent: ligne.quantite_recue === null ? '—' : `${formaterNombre(ligne.quantite_recue, ligne.decimales ?? 0)}${unite}`,
      }));
    }
    if (brouillon && m.sens !== 'ENTREE') {
      const insuffisant = ligne.article_id && (ligne.stock_origine ?? 0) < ligne.quantite;
      rangee.append(creer('td', { className: 'nombre' }, ligne.article_id
        ? creer('span', { className: insuffisant ? 'texte-danger' : '', textContent: `${formaterNombre(ligne.stock_origine ?? 0, ligne.decimales)}${unite}` })
        : '—'));
    }
    return rangee;
  });
  element('lignes').replaceChildren(...(rangees.length ? rangees : [ligneVide(colonnes, 'Aucune ligne.')]));
}

async function valider(m, autorisation) {
  const accord = await confirmer({
    titre: autorisation ? `Autoriser et valider ${m.reference}` : `Valider ${m.reference}`,
    message: `${autorisation ? 'Votre nom sera inscrit comme celui de la personne qui autorise ce mouvement. ' : ''}`
      + 'Les stocks et les matériels sont mis à jour tout de suite ; un mouvement validé ne se modifie plus.',
    libelle: autorisation ? 'Autoriser et valider' : 'Valider',
  });
  if (!accord) return;
  await api(`/mouvements/${m.id}/valider`, { methode: 'POST' });
  afficherMessage(autorisation ? 'Mouvement autorisé et validé.' : 'Mouvement validé.', 'succes');
  await charger();
}

async function annuler(m, brouillon) {
  const resultat = await ouvrirFormulaire({
    titre: brouillon ? `Abandonner le brouillon ${m.reference}` : `Annuler ${m.reference}`,
    champs: [{
      nom: 'motif', libelle: 'Motif', type: 'zone', obligatoire: true, max: 500,
      aide: brouillon
        ? 'Le brouillon reste visible, marqué « annulé » : rien n’est supprimé.'
        : 'Les stocks et les matériels reviennent à leur état d’avant ce mouvement, si c’est encore possible.',
    }],
    libelle: brouillon ? 'Abandonner' : 'Annuler le mouvement',
    envoyer: (valeurs) => api(`/mouvements/${m.id}/annuler`, { methode: 'POST', corps: valeurs }),
  });
  if (!resultat) return;
  afficherMessage(brouillon ? 'Brouillon abandonné.' : 'Mouvement annulé.', 'succes');
  await charger();
}

async function inverse(m) {
  const resultat = await ouvrirFormulaire({
    titre: `Mouvement inverse de ${m.reference}`,
    champs: [{
      nom: 'motif', libelle: 'Motif', type: 'zone', obligatoire: true, max: 400,
      aide: 'Un brouillon est créé avec les quantités inverses ; il devra être validé par un administrateur ou un autre gestionnaire.',
    }],
    libelle: 'Créer le brouillon',
    envoyer: (valeurs) => api(`/mouvements/${m.id}/inverse`, { methode: 'POST', corps: valeurs }),
  });
  if (resultat?.mouvement) window.location.assign(`/mouvements/${resultat.mouvement.id}?enregistre=1`);
}

async function receptionner(m) {
  const recu = await ouvrirReception({
    id: m.id,
    reference: m.reference,
    date_envoi: m.date_mouvement,
    site_origine: m.lignes[0]?.site_origine,
    site_destination: m.lignes[0]?.site_destination,
    lignes: m.lignes.map((ligne) => ({
      ligne_id: ligne.id, nature: ligne.article_id ? 'ARTICLE' : 'MATERIEL', code: ligne.code, designation: ligne.designation,
      quantite: ligne.quantite, symbole: ligne.symbole, decimales: ligne.decimales ?? 0,
    })),
  });
  if (!recu) return;
  afficherMessage('Réception enregistrée.', 'succes');
  await charger();
}

charger().catch((erreur) => {
  afficherMessage(erreur.message);
  element('lignes').replaceChildren(ligneVide(6, erreur.statut === 404 ? 'Mouvement introuvable.' : 'Chargement impossible.'));
});
