// Page Paramètres : une carte par écran de réglage, selon les droits du compte.
import { afficherMessage, creer } from './app.js';
import { initialiserEntete, rubriquesParametres } from './entete.js';
import { icone } from './icones.js';

try {
  const utilisateur = await initialiserEntete();
  const rubriques = rubriquesParametres(utilisateur);
  document.getElementById('rubriques').replaceChildren(...(rubriques.length
    ? rubriques.map((rubrique) => creer('a', { className: `rubrique teinte-${rubrique.teinte}`, href: rubrique.adresse },
      creer('span', { className: 'rubrique-icone' }, icone(rubrique.icone)),
      creer('h2', { textContent: rubrique.titre }),
      creer('p', { textContent: rubrique.texte })))
    // Le mot de passe se change depuis le menu du compte (13/11).
    : [creer('p', { className: 'secondaire' }, 'Aucun réglage pour votre compte. Votre mot de passe se change depuis ',
      creer('a', { href: '/mot-de-passe', textContent: 'Mon mot de passe' }), ' (menu de votre compte, en haut à droite).')]));
} catch (erreur) {
  afficherMessage(erreur.message);
}
