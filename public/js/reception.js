// Dialogue de réception d'un transfert, partagé par la fiche du mouvement et
// l'écran Réceptions. Tout arrive par défaut ; un manquant demande un motif.
import { api, creer, formaterDateCourte, formaterNombre, montrerErreurFormulaire, ouvrirDialogue } from './app.js';

// Date du jour à Antananarivo, au format AAAA-MM-JJ.
export const aujourdhui = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Indian/Antananarivo' }).format(new Date());

// transfert : { id, reference, date_envoi, site_origine, site_destination,
//               lignes: [{ ligne_id, nature: 'ARTICLE'|'MATERIEL', code, designation, quantite, symbole, decimales }] }
// Rend le mouvement reçu, ou null si l'on ferme le dialogue.
export function ouvrirReception(transfert) {
  return new Promise((resoudre) => {
    const formulaire = creer('form', { id: `reception-${transfert.id}`, noValidate: true });
    const zoneErreur = creer('div', { className: 'erreur-formulaire', hidden: true });
    zoneErreur.setAttribute('role', 'alert');

    const saisies = transfert.lignes.map((ligne) => {
      const materiel = ligne.nature === 'MATERIEL';
      const controle = materiel
        ? creer('input', { type: 'checkbox', checked: true })
        : creer('input', { className: 'saisie-quantite', inputMode: 'decimal', value: String(ligne.quantite) });
      controle.setAttribute('aria-label', materiel ? `${ligne.code} arrivé` : `Quantité reçue de ${ligne.designation}`);
      return { ligne, materiel, controle };
    });
    const recue = ({ ligne, materiel, controle }) => {
      if (materiel) return controle.checked ? 1 : 0;
      const valeur = Number(controle.value.replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(valeur) && controle.value.trim() !== '' ? valeur : ligne.quantite;
    };

    const motif = creer('textarea', { name: 'motif_ecart', rows: 2, maxLength: 500 });
    const blocMotif = creer('div', { className: 'champ', hidden: true },
      creer('label', { htmlFor: `${formulaire.id}-motif`, textContent: 'Motif du manquant *' }), motif,
      creer('p', { className: 'aide-champ', textContent: 'Ce qui manque reste « perdu en route » : il ne revient pas au site d’origine.' }));
    motif.id = `${formulaire.id}-motif`;
    const dateReception = creer('input', {
      type: 'date', name: 'date_reception', id: `${formulaire.id}-date`, value: aujourdhui(), min: transfert.date_envoi, max: aujourdhui(),
    });

    const rangees = saisies.map((saisie) => creer('tr', {},
      creer('td', {}, creer('strong', { textContent: saisie.ligne.code }), creer('div', { className: 'secondaire', textContent: saisie.ligne.designation })),
      creer('td', { className: 'nombre', textContent: saisie.materiel ? '1' : `${formaterNombre(saisie.ligne.quantite, saisie.ligne.decimales)} ${saisie.ligne.symbole ?? ''}` }),
      creer('td', { className: 'nombre' }, saisie.materiel
        ? creer('label', { className: 'case' }, saisie.controle, ' Arrivé')
        : creer('span', { className: 'quantite-ligne' }, saisie.controle, ` ${saisie.ligne.symbole ?? ''}`))));
    const ajuster = () => {
      let ecart = false;
      saisies.forEach((saisie, rang) => {
        const manque = recue(saisie) < saisie.ligne.quantite;
        rangees[rang].classList.toggle('ligne-ecart', manque);
        ecart ||= manque;
      });
      blocMotif.hidden = !ecart;
    };
    formulaire.addEventListener('input', ajuster);
    formulaire.addEventListener('change', ajuster);

    formulaire.append(
      zoneErreur,
      creer('p', { className: 'aide', textContent: `Envoyé le ${formaterDateCourte(transfert.date_envoi)} de « ${transfert.site_origine} » vers « ${transfert.site_destination} ». Corrigez seulement ce qui n’est pas arrivé.` }),
      creer('div', { className: 'tableau-conteneur' }, creer('table', { className: 'tableau' },
        creer('thead', {}, creer('tr', {},
          creer('th', { scope: 'col', textContent: 'Article ou matériel' }),
          creer('th', { scope: 'col', className: 'nombre', textContent: 'Envoyé' }),
          creer('th', { scope: 'col', className: 'nombre', textContent: 'Reçu' }))),
        creer('tbody', {}, ...rangees))),
      creer('div', { className: 'champ' },
        creer('label', { htmlFor: dateReception.id, textContent: 'Date de réception' }), dateReception),
      blocMotif,
    );

    const annuler = creer('button', { type: 'button', className: 'bouton bouton-secondaire', textContent: 'Fermer' });
    const valider = creer('button', { type: 'submit', className: 'bouton', textContent: 'Confirmer la réception' });
    valider.setAttribute('form', formulaire.id);
    const { dialogue, fermer } = ouvrirDialogue({ titre: `Réceptionner ${transfert.reference}`, contenu: formulaire, actions: [annuler, valider], large: true });
    let termine = false;
    const finir = (resultat) => {
      if (termine) return;
      termine = true;
      fermer();
      resoudre(resultat);
    };
    annuler.addEventListener('click', () => finir(null));
    dialogue.addEventListener('cancel', () => finir(null));

    formulaire.addEventListener('submit', async (evenement) => {
      evenement.preventDefault();
      zoneErreur.hidden = true;
      if (!blocMotif.hidden && motif.value.trim().length < 3) {
        montrerErreurFormulaire(formulaire, zoneErreur, { message: 'Indiquez le motif du manquant : ce qui n’est pas arrivé, et pourquoi.', champ: 'motif_ecart' });
        return;
      }
      valider.disabled = true;
      try {
        const quantites = saisies
          .filter((saisie) => recue(saisie) !== saisie.ligne.quantite)
          .map((saisie) => ({ ligne_id: saisie.ligne.ligne_id, quantite_recue: recue(saisie) }));
        const { mouvement } = await api(`/mouvements/${transfert.id}/receptionner`, {
          methode: 'POST',
          corps: { quantites, motif_ecart: motif.value.trim() || null, date_reception: dateReception.value || null },
        });
        finir(mouvement);
      } catch (erreur) {
        montrerErreurFormulaire(formulaire, zoneErreur, erreur);
      } finally {
        valider.disabled = false;
      }
    });
    valider.focus();
  });
}
