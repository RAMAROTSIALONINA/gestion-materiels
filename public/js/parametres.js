// Page Paramètres : une carte par écran de réglage, selon les droits du compte.
import { afficherMessage, creer } from './app.js';
import { initialiserEntete, rubriquesParametres } from './entete.js';
import { icone } from './icones.js';

try {
  const utilisateur = await initialiserEntete();
  document.getElementById('rubriques').replaceChildren(...rubriquesParametres(utilisateur).map((rubrique) => creer('a', {
    className: `rubrique teinte-${rubrique.teinte}`, href: rubrique.adresse,
  },
  creer('span', { className: 'rubrique-icone' }, icone(rubrique.icone)),
  creer('h2', { textContent: rubrique.titre }),
  creer('p', { textContent: rubrique.texte }))));
} catch (erreur) {
  afficherMessage(erreur.message);
}
