// Changement de son propre mot de passe (obligatoire après un mot de passe provisoire).
import { afficherMessage, api, montrerErreurFormulaire } from './app.js';
import { initialiserEntete } from './entete.js';

const formulaire = document.getElementById('formulaire');
const zoneErreur = document.getElementById('erreur');
const bouton = document.getElementById('valider');

const utilisateur = await initialiserEntete();
document.getElementById('obligatoire').hidden = !utilisateur.doit_changer_mot_de_passe;

formulaire.addEventListener('submit', async (evenement) => {
  evenement.preventDefault();
  zoneErreur.hidden = true;
  const { actuel, nouveau, confirmation } = formulaire.elements;
  if (nouveau.value !== confirmation.value) {
    montrerErreurFormulaire(formulaire, zoneErreur, { message: 'La confirmation ne correspond pas au nouveau mot de passe.', champ: 'confirmation' });
    return;
  }

  bouton.disabled = true;
  try {
    await api('/auth/mot-de-passe', { methode: 'POST', corps: { actuel: actuel.value, nouveau: nouveau.value } });
    formulaire.reset();
    afficherMessage('Mot de passe enregistré. Vos autres sessions ont été fermées.', 'succes');
    if (utilisateur.doit_changer_mot_de_passe) setTimeout(() => window.location.assign('/'), 1200);
  } catch (erreur) {
    montrerErreurFormulaire(formulaire, zoneErreur, erreur);
  } finally {
    bouton.disabled = false;
  }
});
