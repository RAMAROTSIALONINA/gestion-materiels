// Fiche d'un article : stock total et par site, seuils, derniers mouvements.
import {
  afficherMessage, api, badge, confirmer, creer, definitions, formaterDateCourte, formaterDateHeure, formaterNombre,
  ligneVide, ouvrirFormulaire,
} from './app.js';
import { aLeDroit, initialiserEntete } from './entete.js';

const utilisateur = await initialiserEntete();
const gestion = aLeDroit(utilisateur, 'articles.gerer');
const id = Number(window.location.pathname.split('/').pop());
const element = (nom) => document.getElementById(nom);
const STATUT_MOUVEMENT = { BROUILLON: ['Brouillon', 'badge-neutre'], VALIDE: ['Validé', 'badge-succes'], ANNULE: ['Annulé', 'badge-danger'] };
const carte = (titre, contenu) => creer('section', { className: 'carte' }, creer('h2', { textContent: titre }), contenu);
let article;
let lignesSites = [];

async function charger() {
  const reponse = await api(`/articles/${id}`);
  article = reponse.article;
  lignesSites = reponse.sites;
  const a = article;
  const quantite = (valeur) => `${formaterNombre(valeur, a.decimales)} ${a.symbole}`;
  document.title = `${a.code} — Gestion des matériels`;
  element('titre').textContent = `${a.code} · ${a.designation}`;
  element('pastilles').replaceChildren(...[
    a.en_rupture && badge('Rupture', 'badge-danger'),
    !a.en_rupture && a.alerte_stock_faible && badge('Stock faible', 'badge-attente'),
    !a.actif && badge('Inactif', 'badge-neutre'),
  ].filter(Boolean));
  const actions = [];
  if (aLeDroit(utilisateur, 'mouvements.saisir') && a.actif) {
    const lien = (texte, type) => creer('a', {
      className: 'bouton bouton-secondaire', href: `/mouvements/nouveau?type=${type}&article=${a.id}`, textContent: texte,
    });
    actions.push(lien('Entrée', 'RECEPTION_ACHAT'), lien('Sortie', 'CONSOMMATION'), lien('Transfert', 'TRANSFERT'));
  }
  if (gestion) {
    const modifier = creer('button', { type: 'button', className: 'bouton', textContent: 'Modifier' });
    modifier.addEventListener('click', () => modifierArticle().catch((erreur) => afficherMessage(erreur.message)));
    actions.push(modifier);
    element('ajouter-seuil').hidden = false;
  }
  element('actions').replaceChildren(...actions);

  element('fiche').replaceChildren(
    carte('Stock', definitions([
      ['Disponible (tous sites)', creer('strong', { textContent: quantite(a.quantite_disponible) })],
      ['En route (transferts)', a.quantite_en_route ? quantite(a.quantite_en_route) : '—'],
      ['Seuil minimum global', a.seuil_minimum > 0 ? quantite(a.seuil_minimum) : 'Pas de seuil suivi'],
    ])),
    carte('Identification', definitions([
      ['Code', creer('strong', { textContent: a.code })],
      ['Désignation', a.designation],
      ['Catégorie', a.categorie],
      ['Unité', `${a.unite} (${a.symbole})${a.unite_figee ? ' — figée' : ''}`],
      ['Magasin habituel', [a.site_stockage, a.emplacement].filter(Boolean).join(' · ')],
    ])),
    carte('Suivi', definitions([
      ['Créé', `${formaterDateHeure(a.cree_le)} par ${a.cree_par_nom ?? '—'}`],
      ['Dernière modification', a.modifie_par_nom ? `${formaterDateHeure(a.modifie_le)} par ${a.modifie_par_nom}` : '—'],
      ['Observations', a.observations],
    ])),
  );

  element('sites').replaceChildren(...(lignesSites.length ? lignesSites.map((s) => {
    const actions = creer('div', { className: 'actions-ligne' });
    if (gestion) {
      const fixer = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: s.seuil_site ? 'Modifier le seuil' : 'Fixer un seuil' });
      fixer.addEventListener('click', () => fixerSeuil(s.site_id, s.seuil_site));
      actions.append(fixer);
      if (s.seuil_site) {
        const retirer = creer('button', { type: 'button', className: 'bouton bouton-petit bouton-secondaire', textContent: 'Retirer' });
        retirer.addEventListener('click', () => retirerSeuil(s));
        actions.append(retirer);
      }
    }
    return creer('tr', {},
      creer('td', { textContent: s.site }),
      creer('td', { className: 'nombre', textContent: quantite(s.quantite) }),
      creer('td', { className: 'nombre', textContent: s.seuil_site ? quantite(s.seuil_site) : '—' }),
      creer('td', {}, s.alerte_site ? badge(s.quantite === 0 ? 'Rupture sur ce site' : 'Sous le seuil', s.quantite === 0 ? 'badge-danger' : 'badge-attente') : '—'),
      creer('td', {}, actions));
  }) : [ligneVide(5, 'Aucun stock ni seuil par site pour l’instant.')]));

  element('mouvements').replaceChildren(...(reponse.mouvements.length ? reponse.mouvements.map((mv) => {
    const [libelle, classe] = STATUT_MOUVEMENT[mv.statut];
    return creer('tr', {},
      creer('td', { textContent: formaterDateCourte(mv.date_mouvement) }),
      creer('td', {}, creer('strong', {}, aLeDroit(utilisateur, 'mouvements.lire')
        ? creer('a', { href: `/mouvements/${mv.mouvement_id}`, textContent: mv.reference })
        : mv.reference)),
      creer('td', { textContent: mv.type }),
      creer('td', { className: 'nombre', textContent: quantite(mv.quantite) }),
      creer('td', { textContent: [mv.site_origine, mv.site_destination].filter(Boolean).join(' → ') || '—' }),
      creer('td', { textContent: [mv.service_beneficiaire ?? mv.employe_beneficiaire, mv.motif].filter(Boolean).join(' · ') || '—' }),
      creer('td', {}, badge(libelle, classe), mv.etat_transfert === 'EN_ROUTE' ? badge('En route', 'badge-info') : null));
  }) : [ligneVide(7, 'Aucun mouvement pour l’instant.')]));
}

async function fixerSeuil(siteId = null, seuilActuel = null) {
  const sites = (await api('/referentiels/sites')).sites.filter((s) => s.actif || s.id === siteId);
  const resultat = await ouvrirFormulaire({
    titre: 'Seuil d’un site',
    valeurs: { site_id: siteId, seuil_minimum: seuilActuel },
    champs: [
      { nom: 'site_id', libelle: 'Site', type: 'liste', obligatoire: true, vide: 'Choisir', desactive: Boolean(siteId), options: sites.map((s) => ({ valeur: s.id, libelle: s.nom })) },
      { nom: 'seuil_minimum', libelle: `Seuil (${article.symbole})`, type: 'nombre', obligatoire: true, max: 15 },
    ],
    envoyer: (valeurs) => {
      const site = siteId ?? valeurs.site_id;
      if (!site) throw Object.assign(new Error('Choisissez un site.'), { champ: 'site_id' });
      return api(`/articles/${id}/seuils/${site}`, { methode: 'PUT', corps: { seuil_minimum: valeurs.seuil_minimum } });
    },
  });
  if (!resultat) return;
  afficherMessage('Seuil enregistré.', 'succes');
  await charger();
}

async function retirerSeuil(ligneSite) {
  const accord = await confirmer({
    titre: 'Retirer ce seuil ?',
    message: `Le site ${ligneSite.site} ne sera plus surveillé à part ; le seuil global de l’article reste en place.`,
    libelle: 'Retirer',
  });
  if (!accord) return;
  try {
    await api(`/articles/${id}/seuils/${ligneSite.site_id}`, { methode: 'DELETE' });
    afficherMessage('Seuil retiré.', 'succes');
    await charger();
  } catch (erreur) {
    afficherMessage(erreur.message);
  }
}

async function modifierArticle() {
  const [categories, unites, sites] = await Promise.all([
    api('/referentiels/categories').then((r) => r.categories.filter((c) => c.type === 'ARTICLE')),
    api('/referentiels/unites').then((r) => r.unites),
    api('/referentiels/sites').then((r) => r.sites),
  ]);
  const a = article;
  const resultat = await ouvrirFormulaire({
    titre: `Modifier ${a.code}`,
    valeurs: a,
    champs: [
      { nom: 'designation', libelle: 'Désignation', obligatoire: true, max: 150 },
      { nom: 'categorie_id', libelle: 'Catégorie', type: 'liste', obligatoire: true, options: categories.filter((c) => c.actif || c.id === a.categorie_id).map((c) => ({ valeur: c.id, libelle: c.nom })) },
      {
        nom: 'unite_code', libelle: 'Unité', type: 'liste', obligatoire: true, desactive: a.unite_figee,
        options: unites.map((u) => ({ valeur: u.code, libelle: `${u.libelle} (${u.symbole})` })),
        aide: a.unite_figee ? 'Figée : l’article a déjà des mouvements.' : null,
      },
      { nom: 'seuil_minimum', libelle: 'Seuil minimum (tous sites)', type: 'nombre', obligatoire: true, max: 15, aide: '0 = pas de seuil suivi.' },
      { nom: 'site_stockage_id', libelle: 'Magasin habituel', type: 'liste', vide: 'Aucun', options: sites.filter((s) => s.actif || s.id === a.site_stockage_id).map((s) => ({ valeur: s.id, libelle: s.nom })) },
      { nom: 'emplacement', libelle: 'Emplacement', max: 80 },
      { nom: 'observations', libelle: 'Observations', type: 'zone', max: 1000 },
      { nom: 'actif', libelle: 'Article actif', type: 'case', aide: 'Un article inactif n’est plus proposé dans les mouvements.' },
    ],
    envoyer: (valeurs) => {
      const corps = { ...valeurs };
      if (a.unite_figee) delete corps.unite_code;
      return api(`/articles/${id}`, { methode: 'PATCH', corps });
    },
  });
  if (!resultat) return;
  afficherMessage('Article modifié.', 'succes');
  await charger();
}

element('ajouter-seuil').addEventListener('click', () => fixerSeuil().catch((erreur) => afficherMessage(erreur.message)));
charger().catch((erreur) => {
  element('titre').textContent = 'Article introuvable';
  afficherMessage(erreur.message);
});
