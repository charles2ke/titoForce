import type { Translation } from '../../index.ts';

export default {
  network: 'Der titoForce-Server ist nicht erreichbar. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.',
  api: {
    unauthenticated: 'Bitte melden Sie sich an',
    invalid_credentials: 'E-Mail-Adresse oder Passwort ungültig',
    rate_limited: 'Zu viele Anfragen. Bitte warten Sie einen Moment und versuchen Sie es erneut.',
    invalid_password: 'Ihr aktuelles Passwort ist falsch',
    unsupported_media_type: 'Senden Sie Anfragen mit „Content-Type: application/json“',
    invalid_json: 'Der Anfragetext ist kein gültiges JSON',
    forbidden: 'Sie haben keine Berechtigung für diese Aktion.',
    not_found: 'Das Element wurde nicht gefunden oder Sie haben keinen Zugriff darauf.',
    edit_conflict: 'Jemand anderes hat diesen Datensatz geändert, während Sie ihn bearbeitet haben.',
    organization_not_found: 'Es gibt keine Organisation mit dieser ID.',
    organization_mismatch: 'Diese Adresse gehört zu einer anderen Organisation.',
    organization_suspended: 'Diese Organisation ist gesperrt. Wenden Sie sich an den Serveradministrator.',
    organization_unavailable: 'Diese Organisation wird gerade vorbereitet. Versuchen Sie es gleich noch einmal.',
    nothing_to_deploy: 'Wählen Sie mindestens eine neue oder geänderte Komponente zum Bereitstellen aus.',
    http_error: 'Anfrage fehlgeschlagen',
  },
} satisfies Translation['errors'];
