// Scanner un code-barres avec la caméra du téléphone, de la tablette ou du PC
// (13/11). Ouvre une fenêtre avec l'image de la caméra ; dès qu'un code est
// lu, la fenêtre se ferme et le code est rendu. La caméra est coupée dès que
// la fenêtre se ferme, quelle qu'en soit la raison.
// Lecture : le détecteur intégré au navigateur s'il en a un (Chrome sur
// Android), sinon — et en renfort — notre lecteur Code 128 (lecteur-code128.js).
import { creer, ouvrirDialogue } from './app.js';
import { lireImage } from './lecteur-code128.js';

const INTERVALLE_MS = 150;
const LARGEUR_MAX = 1280;

// La caméra n'est offerte qu'en https (ou sur le poste de développement).
export function cameraDisponible() {
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

function messageErreur(erreur) {
  switch (erreur?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'L’accès à la caméra a été refusé. Autorisez la caméra pour ce site dans le navigateur, '
        + 'ou saisissez le code au clavier.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'Aucune caméra n’a été trouvée sur cet appareil. Utilisez une douchette ou saisissez le code au clavier.';
    case 'NotReadableError':
      return 'La caméra est déjà utilisée par une autre application. Fermez-la, puis réessayez.';
    default:
      return 'La caméra n’a pas pu être ouverte. Saisissez le code au clavier.';
  }
}

async function detecteurIntegre() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const formats = await window.BarcodeDetector.getSupportedFormats();
    return formats.includes('code_128') ? new window.BarcodeDetector({ formats: ['code_128'] }) : null;
  } catch {
    return null;
  }
}

// Rend le code lu (texte), ou null si l'on ferme la fenêtre sans lecture.
export function scannerCodeBarres({ titre = 'Scanner le code-barres' } = {}) {
  return new Promise((resoudre) => {
    const video = creer('video', { className: 'scan-video', muted: true, autoplay: true });
    video.setAttribute('playsinline', '');      // iPhone : pas de plein écran
    video.setAttribute('aria-hidden', 'true');
    const viseur = creer('div', { className: 'scan-viseur' });
    viseur.setAttribute('aria-hidden', 'true');
    const cadre = creer('div', { className: 'scan-cadre' }, video, viseur);
    const etat = creer('p', { className: 'scan-etat', textContent: 'Ouverture de la caméra…' });
    etat.setAttribute('role', 'status');
    const annuler = creer('button', { type: 'button', className: 'bouton bouton-secondaire', textContent: 'Annuler' });
    const { dialogue, fermer } = ouvrirDialogue({ titre, contenu: creer('div', { className: 'scan' }, cadre, etat), actions: [annuler] });
    dialogue.classList.add('dialogue-scan');

    let flux = null;
    let minuterie = null;
    let fini = false;
    const lectures = new Map();     // texte → nombre de fois lu (notre lecteur : 2 lectures exigées)
    const toile = document.createElement('canvas');
    const contexte = toile.getContext('2d', { willReadFrequently: true });

    const terminer = (code) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      flux?.getTracks().forEach((piste) => piste.stop());
      if (dialogue.open) fermer();
      resoudre(code);
    };
    dialogue.addEventListener('close', () => terminer(null));
    annuler.addEventListener('click', () => terminer(null));

    const montrerErreur = (message) => {
      cadre.hidden = true;
      etat.className = 'avertissement';
      etat.textContent = message;
      annuler.textContent = 'Fermer';
      annuler.focus();
    };

    const analyser = async (detecteur) => {
      if (fini) return;
      if (video.readyState >= 2 && video.videoWidth) {
        let code = null;
        if (detecteur) {
          try {
            const [trouve] = await detecteur.detect(video);
            code = trouve?.rawValue || null;
          } catch {
            // le lecteur maison prend le relais
          }
        }
        if (!code) {
          const echelle = Math.min(1, LARGEUR_MAX / video.videoWidth);
          const largeur = Math.round(video.videoWidth * echelle);
          const hauteur = Math.round(video.videoHeight * echelle);
          if (toile.width !== largeur || toile.height !== hauteur) {
            toile.width = largeur;
            toile.height = hauteur;
          }
          contexte.drawImage(video, 0, 0, largeur, hauteur);
          const resultat = lireImage(contexte.getImageData(0, 0, largeur, hauteur));
          if (resultat) {
            const fois = (lectures.get(resultat.texte) ?? 0) + resultat.lectures;
            lectures.set(resultat.texte, fois);
            if (fois >= 2) code = resultat.texte;
          }
        }
        if (fini) return;
        if (code) {
          navigator.vibrate?.(60);
          terminer(code.trim());
          return;
        }
      }
      minuterie = setTimeout(() => analyser(detecteur), INTERVALLE_MS);
    };

    if (!cameraDisponible()) {
      montrerErreur('La caméra n’est pas disponible dans ce navigateur. Saisissez le code au clavier.');
      return;
    }
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }).then(async (ouvert) => {
      if (fini) {
        ouvert.getTracks().forEach((piste) => piste.stop());
        return;
      }
      flux = ouvert;
      video.srcObject = ouvert;
      await video.play().catch(() => {});
      etat.textContent = 'Placez le code-barres de l’étiquette dans le cadre, à 10 ou 15 cm, bien net et bien éclairé.';
      analyser(await detecteurIntegre());
    }).catch((erreur) => {
      if (!fini) montrerErreur(messageErreur(erreur));
    });
  });
}
