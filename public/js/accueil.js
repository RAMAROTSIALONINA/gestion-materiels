// Tableau de bord (phase 8, cahier des charges § 3.1) : cartes de synthèse du
// parc, des articles et des mouvements de la période, alertes de stock,
// mouvements récents ; filtres de période, site, service et catégorie.
// Décision du 12/11 : le nombre d'articles seulement (les unités diffèrent).
// L'administrateur voit aussi l'état du serveur et de la base, en bas.
import {
  LIBELLES_STATUT, afficherMessage, api, badge, creer, differer, ecrireFiltresAdresse, formaterDateCourte, formaterNombre, lireFiltresAdresse,
} from './app.js';
import { aLeDroit, initialiserEntete, pageAccueil } from './entete.js';

const element = (id) => document.getElementById(id);
const filtres = element('filtres');
const nombre = (n) => new Intl.NumberFormat('fr-FR').format(n ?? 0);
const pluriel = (n, mot, motPluriel = `${mot}s`) => `${nombre(n)} ${n > 1 ? motPluriel : mot}`;

// ---------------------------------------------------------------------------
// Graphiques (13/11) : dessinés sans bibliothèque. L'anneau du parc et la
// série des mouvements sont en SVG, les barres des articles en HTML. Ils
// suivent les filtres et le périmètre du tableau de bord.
// ---------------------------------------------------------------------------
const SVG = 'http://www.w3.org/2000/svg';
const ORDRE_STATUTS = ['DISPONIBLE', 'AFFECTE', 'EN_REPARATION', 'EN_TRANSIT', 'PERDU', 'REFORME'];
const TEINTE_STATUT = {
  DISPONIBLE: 'vert', AFFECTE: 'bleu', EN_REPARATION: 'jaune', EN_TRANSIT: 'indigo', PERDU: 'rouge', REFORME: 'gris',
};

function svg(balise, attributs = {}, ...enfants) {
  const noeud = document.createElementNS(SVG, balise);
  for (const [nom, valeur] of Object.entries(attributs)) noeud.setAttribute(nom, valeur);
  noeud.append(...enfants);
  return noeud;
}

function pastille(teinte) {
  const point = creer('span', { className: `graphique-pastille teinte-${teinte}` });
  point.setAttribute('aria-hidden', 'true');
  return point;
}

function resumeCache(texte) {
  return creer('p', { className: 'visuellement-cache', textContent: texte });
}

// Anneau des statuts : chaque part est un arc de cercle proportionnel.
function dessinerParc(m) {
  const zone = element('graphique-parc');
  element('detail-graphique-parc').textContent = m.sortis
    ? `${nombre(m.total)} actif${m.total > 1 ? 's' : ''} · ${nombre(m.sortis)} sorti${m.sortis > 1 ? 's' : ''}`
    : `${nombre(m.total)} actif${m.total > 1 ? 's' : ''}`;
  const parts = ORDRE_STATUTS
    .map((code) => ({ code, nombre: m.statuts?.[code] ?? 0, teinte: TEINTE_STATUT[code] }))
    .filter((part) => part.nombre > 0);
  if (!parts.length) {
    zone.replaceChildren(creer('p', { className: 'secondaire', textContent: 'Aucun matériel pour ces filtres.' }));
    return;
  }
  const total = parts.reduce((somme, part) => somme + part.nombre, 0);
  const rayon = 48;
  const perimetre = 2 * Math.PI * rayon;
  let depart = 0;
  const segments = parts.map((part) => {
    const longueur = (part.nombre / total) * perimetre;
    const arc = svg('circle', {
      class: 'anneau-part', cx: 60, cy: 60, r: rayon,
      stroke: `var(--teinte-${part.teinte})`,
      'stroke-dasharray': `${Math.max(longueur - 1.5, 0.5)} ${perimetre}`,
      'stroke-dashoffset': -depart,
      transform: 'rotate(-90 60 60)',
    });
    depart += longueur;
    arc.append(svg('title', {}, `${LIBELLES_STATUT[part.code] ?? part.code} : ${nombre(part.nombre)}`));
    return arc;
  });
  const anneau = svg('svg', { viewBox: '0 0 120 120', class: 'anneau-svg', 'aria-hidden': 'true' },
    svg('circle', { class: 'anneau-piste', cx: 60, cy: 60, r: rayon }), ...segments);
  const centre = creer('div', { className: 'anneau-centre' },
    creer('strong', { textContent: nombre(total) }),
    creer('span', { textContent: total > 1 ? 'matériels' : 'matériel' }));
  const legende = creer('ul', { className: 'graphique-legende' }, ...parts.map((part) => creer('li', {},
    pastille(part.teinte),
    creer('span', { className: 'graphique-libelle', textContent: LIBELLES_STATUT[part.code] ?? part.code }),
    creer('strong', { className: 'graphique-valeur', textContent: nombre(part.nombre) }))));
  zone.replaceChildren(
    creer('div', { className: 'anneau-graphique' }, creer('div', { className: 'anneau-visuel' }, anneau, centre), legende),
    resumeCache(`Parc : ${parts.map((part) => `${LIBELLES_STATUT[part.code] ?? part.code} ${part.nombre}`).join(', ')}.`),
  );
}

// Barres des articles : stock suffisant, sous le seuil, rupture (parts du total).
function dessinerArticles(a, surSite) {
  const zone = element('graphique-articles');
  element('detail-graphique-articles').textContent = `${nombre(a.total)} article${a.total > 1 ? 's' : ''}${surSite ? ' sur le site' : ''}`;
  if (!a.total) {
    zone.replaceChildren(creer('p', { className: 'secondaire', textContent: 'Aucun article suivi pour ces filtres.' }));
    return;
  }
  const lignes = [
    { libelle: 'Stock suffisant', valeur: Math.max(a.en_stock - a.sous_seuil, 0), teinte: 'vert' },
    { libelle: 'Sous le seuil', valeur: a.sous_seuil, teinte: 'orange' },
    { libelle: 'En rupture', valeur: a.en_rupture, teinte: 'rouge' },
  ];
  const barres = lignes.map((ligne) => {
    const part = creer('span', { className: `barre-part teinte-${ligne.teinte}` });
    part.style.width = `${(ligne.valeur / a.total) * 100}%`;
    return creer('div', { className: 'barre-ligne' },
      creer('div', { className: 'barre-entete' },
        creer('span', { className: 'barre-libelle' }, pastille(ligne.teinte), creer('span', { textContent: ligne.libelle })),
        creer('strong', { textContent: nombre(ligne.valeur) })),
      creer('div', { className: 'barre-piste', title: `${nombre(ligne.valeur)} sur ${nombre(a.total)}` }, part));
  });
  zone.replaceChildren(
    creer('div', { className: 'barres-horizontales' }, ...barres),
    resumeCache(`Articles : ${lignes.map((ligne) => `${ligne.libelle} ${ligne.valeur}`).join(', ')} sur ${a.total}.`),
  );
}

const jourDepuisIso = (texte) => {
  const [annee, mois, jour] = texte.split('-').map(Number);
  return new Date(Date.UTC(annee, mois - 1, jour));
};
const isoDepuisJour = (date) => date.toISOString().slice(0, 10);
const libelleJour = (date) => `${date.getUTCDate()}/${date.getUTCMonth() + 1}`;

// Regroupe la série quotidienne pour rester lisible : jours, semaines de
// 7 jours, puis mois si la période dépasse environ six mois.
function seriesMouvements(debut, fin, brute) {
  const trouve = new Map(brute.map((ligne) => [ligne.jour, ligne]));
  const dates = [];
  for (let date = jourDepuisIso(debut); date <= jourDepuisIso(fin); date = new Date(date.getTime() + 86_400_000)) dates.push(date);
  const valeurs = (date) => {
    const ligne = trouve.get(isoDepuisJour(date));
    return { entrees: ligne?.entrees ?? 0, sorties: ligne?.sorties ?? 0, transferts: ligne?.transferts ?? 0 };
  };
  if (dates.length <= 45) {
    return dates.map((date) => ({
      ...valeurs(date), court: libelleJour(date), titre: formaterDateCourte(isoDepuisJour(date)),
    }));
  }
  if (dates.length <= 190) {
    const points = [];
    for (let debutTranche = 0; debutTranche < dates.length; debutTranche += 7) {
      const tranche = dates.slice(debutTranche, debutTranche + 7);
      const point = {
        entrees: 0, sorties: 0, transferts: 0, court: libelleJour(tranche[0]),
        titre: `Du ${formaterDateCourte(isoDepuisJour(tranche[0]))} au ${formaterDateCourte(isoDepuisJour(tranche.at(-1)))}`,
      };
      for (const date of tranche) {
        const valeur = valeurs(date);
        point.entrees += valeur.entrees;
        point.sorties += valeur.sorties;
        point.transferts += valeur.transferts;
      }
      points.push(point);
    }
    return points;
  }
  const court = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const points = [];
  let courant = null;
  for (const date of dates) {
    const cle = isoDepuisJour(date).slice(0, 7);
    if (courant?.cle !== cle) {
      courant = { cle, entrees: 0, sorties: 0, transferts: 0, court: court.format(date), titre: long.format(date) };
      points.push(courant);
    }
    const valeur = valeurs(date);
    courant.entrees += valeur.entrees;
    courant.sorties += valeur.sorties;
    courant.transferts += valeur.transferts;
  }
  return points;
}

function dessinerMouvements(donnees) {
  const zone = element('graphique-mouvements');
  const mv = donnees.mouvements;
  const total = mv.entrees + mv.sorties + mv.transferts;
  element('titre-graphique-mouvements').textContent = `Mouvements du ${formaterDateCourte(donnees.periode.debut)} au ${formaterDateCourte(donnees.periode.fin)}`;
  element('detail-graphique-mouvements').textContent = `${nombre(total)} mouvement${total > 1 ? 's' : ''} validé${total > 1 ? 's' : ''}`;
  const points = seriesMouvements(donnees.periode.debut, donnees.periode.fin, donnees.serie_mouvements ?? []);
  if (!points.some((point) => point.entrees + point.sorties + point.transferts > 0)) {
    zone.replaceChildren(creer('p', { className: 'secondaire', textContent: 'Aucun mouvement validé sur la période.' }));
    return;
  }
  const largeur = 720;
  const hauteur = 190;
  const marge = { haut: 12, droite: 8, bas: 26, gauche: 34 };
  const utileLargeur = largeur - marge.gauche - marge.droite;
  const utileHauteur = hauteur - marge.haut - marge.bas;
  const maximum = Math.max(...points.map((point) => point.entrees + point.sorties + point.transferts), 1);
  const largeurGroupe = utileLargeur / points.length;
  const largeurBarre = Math.max(2, Math.min(30, largeurGroupe * 0.62));
  const pasLibelle = Math.max(1, Math.ceil(points.length / 7));
  const dernier = points.length - 1;
  const morceaux = [];
  for (const cran of [...new Set([0, Math.round(maximum / 2), maximum])]) {
    const y = marge.haut + utileHauteur - (cran / maximum) * utileHauteur;
    morceaux.push(svg('line', {
      x1: marge.gauche, x2: largeur - marge.droite, y1: y, y2: y, class: cran === 0 ? 'graphique-axe' : 'graphique-grille',
    }));
    morceaux.push(svg('text', {
      x: marge.gauche - 6, y: y + 3.5, 'text-anchor': 'end', class: 'graphique-etiquette',
    }, nombre(cran)));
  }
  const couleurs = [['entrees', 'vert'], ['sorties', 'orange'], ['transferts', 'indigo']];
  points.forEach((point, indice) => {
    const x = marge.gauche + indice * largeurGroupe + (largeurGroupe - largeurBarre) / 2;
    let bas = marge.haut + utileHauteur;
    const groupe = svg('g', {});
    groupe.append(svg('title', {},
      `${point.titre} — ${point.entrees} entrée${point.entrees > 1 ? 's' : ''}, ${point.sorties} sortie${point.sorties > 1 ? 's' : ''}, ${point.transferts} transfert${point.transferts > 1 ? 's' : ''}`));
    for (const [cle, teinte] of couleurs) {
      const valeur = point[cle];
      if (!valeur) continue;
      const part = (valeur / maximum) * utileHauteur;
      bas -= part;
      groupe.append(svg('rect', {
        x, y: bas, width: largeurBarre, height: Math.max(part, 1), rx: 1.5, fill: `var(--teinte-${teinte})`,
      }));
    }
    morceaux.push(groupe);
    if (indice % pasLibelle === 0 || (indice === dernier && dernier % pasLibelle >= Math.ceil(pasLibelle / 2))) {
      morceaux.push(svg('text', {
        x: x + largeurBarre / 2, y: hauteur - 8, 'text-anchor': 'middle', class: 'graphique-etiquette',
      }, point.court));
    }
  });
  const dessin = svg('svg', { viewBox: `0 0 ${largeur} ${hauteur}`, class: 'graphique-serie', 'aria-hidden': 'true' }, ...morceaux);
  const legende = creer('div', { className: 'graphique-legende-inline' }, ...couleurs.map(([cle, teinte]) => creer('span', {
    className: 'graphique-legende-item',
  }, pastille(teinte), creer('span', { textContent: { entrees: 'Entrées', sorties: 'Sorties', transferts: 'Transferts' }[cle] }),
  creer('strong', { textContent: nombre(mv[cle]) }))));
  zone.replaceChildren(dessin, legende,
    resumeCache(`${total > 1 ? 'Mouvements validés' : 'Mouvement validé'} du ${formaterDateCourte(donnees.periode.debut)} au ${formaterDateCourte(donnees.periode.fin)} : `
      + `${mv.entrees} entrée${mv.entrees > 1 ? 's' : ''}, ${mv.sorties} sortie${mv.sorties > 1 ? 's' : ''}, `
      + `${mv.transferts} transfert${mv.transferts > 1 ? 's' : ''}.`));
}


function afficher(donnees, choix) {
  const m = donnees.materiels;
  const a = donnees.articles;
  const surSite = donnees.perimetre === 'service' || Boolean(choix.site_id);

  // Alertes de stock (ruptures d'abord).
  const alertes = donnees.alertes_stock;
  element('alertes-stock').replaceChildren(...(alertes.elements.length
    ? [
      ...alertes.elements.map((al) => creer('li', {},
        creer('div', { className: 'alerte-article' },
          creer('a', { href: `/articles/${al.article_id}`, textContent: al.designation }),
          creer('span', { className: 'secondaire', textContent: [al.code, al.site].filter(Boolean).join(' · ') })),
        creer('div', { className: 'alerte-quantite' },
          creer('span', { textContent: `${formaterNombre(al.quantite, al.decimales)} / ${formaterNombre(al.seuil, al.decimales)} ${al.symbole}` }),
          al.en_rupture ? badge('Rupture', 'badge-danger') : badge('Sous le seuil', 'badge-attente')))),
      alertes.total > alertes.elements.length
        && creer('li', { className: 'secondaire' }, `Et ${pluriel(alertes.total - alertes.elements.length, 'autre')} : `,
          creer('a', { href: '/articles?alerte=oui', textContent: 'voir les articles en alerte' })),
    ].filter(Boolean)
    : [creer('li', { className: 'secondaire', textContent: 'Aucun article sous le seuil.' })]));

  // Mouvements récents.
  element('recents').replaceChildren(...(donnees.recents.length
    ? donnees.recents.map((r) => creer('tr', {},
      creer('td', {}, creer('strong', {}, creer('a', { href: `/mouvements/${r.id}`, textContent: r.reference })),
        creer('div', { className: 'secondaire', textContent: formaterDateCourte(r.date_mouvement) })),
      creer('td', { className: 'cellule-principale' },
        creer('div', { textContent: `${r.premiere_ligne ?? '—'}${r.nb_lignes > 1 ? ` + ${r.nb_lignes - 1}` : ''}` }),
        creer('div', { className: 'secondaire' }, r.type, r.en_route ? ' ' : null, r.en_route ? badge('En route', 'badge-attente') : null)),
      creer('td', { textContent: [r.site_origine, r.site_destination].filter(Boolean).join(' → ') || '—' })))
    : [creer('tr', {}, creer('td', { colSpan: 3, className: 'cellule-vide', textContent: 'Aucun mouvement sur la période.' }))]));

  // Graphiques : mêmes données, mêmes filtres que les cartes.
  dessinerParc(m);
  dessinerArticles(a, surSite);
  dessinerMouvements(donnees);
}

async function charger() {
  const choix = Object.fromEntries(['date_debut', 'date_fin', 'site_id', 'service_id', 'categorie_id']
    .map((nom) => [nom, filtres.elements[nom].value]));
  const parametres = ecrireFiltresAdresse(choix);
  afficher(await api(`/tableau-de-bord?${parametres}`), choix);
}

// État du serveur et de la base (administrateur), en une ligne.
async function verifierServeur() {
  const pastille = element('pastille');
  const texte = element('etat-texte');
  pastille.className = 'pastille pastille-attente';
  pastille.textContent = 'Vérification…';
  try {
    const etat = await api('/sante');
    pastille.className = 'pastille pastille-ok';
    pastille.textContent = 'Serveur opérationnel';
    texte.textContent = `Version ${etat.version} · base ${etat.base?.version_schema ?? '—'} · ${etat.base?.delai_ms ?? '—'} ms`;
  } catch (erreur) {
    pastille.className = 'pastille pastille-ko';
    pastille.textContent = 'Problème';
    texte.textContent = erreur.donnees?.base?.message ?? erreur.message;
  }
}

const utilisateur = await initialiserEntete();
if (pageAccueil(utilisateur) !== '/' || !aLeDroit(utilisateur, 'rapports.lire')) {
  // L'employé n'a que ses matériels : il y va directement.
  window.location.replace(aLeDroit(utilisateur, 'mes_materiels.lire') ? '/mes-materiels' : '/parametres');
} else {
  element('lien-rapports').hidden = false;
  element('lien-inventaire').hidden = !aLeDroit(utilisateur, 'materiels.lire');
  const { sites, services, categories, responsable } = await api('/rapports/options');
  for (const site of sites) filtres.elements.site_id.append(creer('option', { value: String(site.id), textContent: site.nom }));
  for (const service of services) filtres.elements.service_id.append(creer('option', { value: String(service.id), textContent: service.nom }));
  for (const [type, libelle] of [['MATERIEL', 'Matériels'], ['ARTICLE', 'Articles']]) {
    filtres.elements.categorie_id.append(creer('optgroup', { label: libelle },
      ...categories.filter((c) => c.type === type).map((c) => creer('option', { value: String(c.id), textContent: c.nom }))));
  }
  // Le responsable ne voit que son service : le filtre de service est inutile.
  element('champ-service').hidden = responsable;
  if (responsable) {
    element('presentation').textContent = 'Vue d’ensemble de votre service : ses matériels, et les articles du site de votre service. '
      + 'Les mouvements sont comptés sur la période choisie (les 30 derniers jours si vous n’en choisissez pas).';
  }
  const initiaux = lireFiltresAdresse();
  for (const nom of ['date_debut', 'date_fin', 'site_id', 'service_id', 'categorie_id']) filtres.elements[nom].value = initiaux[nom] ?? '';
  const recharger = () => charger().catch((erreur) => afficherMessage(erreur.message));
  for (const nom of ['site_id', 'service_id', 'categorie_id']) filtres.elements[nom].addEventListener('change', recharger);
  for (const nom of ['date_debut', 'date_fin']) filtres.elements[nom].addEventListener('change', differer(recharger, 400));
  filtres.addEventListener('submit', (evenement) => evenement.preventDefault());
  recharger();

  if (utilisateur.role === 'ADMIN') {
    element('etat-serveur').hidden = false;
    element('actualiser').addEventListener('click', verifierServeur);
    verifierServeur();
  }
}
