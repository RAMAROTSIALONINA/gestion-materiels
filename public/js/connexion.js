// Page de connexion.
import { api, retourSur } from './app.js';

const formulaire = document.getElementById('formulaire');
const zoneErreur = document.getElementById('erreur');
const bouton = document.getElementById('valider');

function montrer(message) {
  zoneErreur.textContent = message;
  zoneErreur.hidden = false;
}

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  zoneErreur.hidden = true;
  const identifiant = formulaire.elements.identifiant.value.trim();
  const motDePasse = formulaire.elements.mot_de_passe.value;
  if (!identifiant || !motDePasse) {
    montrer('Saisissez votre identifiant (ou adresse e-mail) et votre mot de passe.');
    return;
  }

  bouton.disabled = true;
  bouton.textContent = 'Connexion…';
  try {
    const { utilisateur } = await api('/auth/connexion', {
      methode: 'POST',
      corps: { identifiant, mot_de_passe: motDePasse },
    });
    window.location.assign(utilisateur.doit_changer_mot_de_passe ? '/mot-de-passe' : retourSur());
  } catch (erreur) {
    montrer(erreur.message);
    formulaire.elements.mot_de_passe.value = '';
    formulaire.elements.mot_de_passe.focus();
    bouton.disabled = false;
    bouton.textContent = 'Se connecter';
  }
});
