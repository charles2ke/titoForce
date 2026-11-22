import type { Translation } from '../../index.ts';

export default {
  network: 'Impossible de joindre le serveur titoForce. Vérifiez votre connexion et réessayez.',
  api: {
    unauthenticated: 'Veuillez vous connecter',
    invalid_credentials: 'E-mail ou mot de passe incorrect',
    rate_limited: 'Trop de demandes. Veuillez patienter un instant et réessayer.',
    invalid_password: 'Votre mot de passe actuel est incorrect',
    unsupported_media_type: 'Envoyez les requêtes avec « Content-Type: application/json »',
    invalid_json: 'Le corps de la requête n’est pas un JSON valide',
    forbidden: 'Vous n’avez pas l’autorisation d’effectuer cette action.',
    not_found: 'L’élément est introuvable ou vous n’y avez pas accès.',
    edit_conflict: 'Quelqu’un d’autre a modifié cet enregistrement pendant que vous le modifiiez.',
    organization_not_found: 'Aucune organisation ne correspond à cet identifiant.',
    organization_mismatch: 'Cette adresse appartient à une autre organisation.',
    organization_suspended: 'Cette organisation est suspendue. Contactez l’administrateur du serveur.',
    organization_unavailable: 'Cette organisation est en cours de préparation. Réessayez dans un instant.',
    nothing_to_deploy: 'Sélectionnez au moins un composant nouveau ou modifié à déployer.',
    http_error: 'Échec de la demande',
  },
} satisfies Translation['errors'];
