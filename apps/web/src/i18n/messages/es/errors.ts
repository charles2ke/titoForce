import type { Translation } from '../../index.ts';

export default {
  network: 'No se puede conectar con el servidor de titoForce. Compruebe la conexión e inténtelo de nuevo.',
  api: {
    unauthenticated: 'Inicie sesión',
    invalid_credentials: 'Correo electrónico o contraseña no válidos',
    rate_limited: 'Demasiadas solicitudes. Espere un momento e inténtelo de nuevo.',
    invalid_password: 'La contraseña actual no es correcta',
    unsupported_media_type: 'Envíe las solicitudes con “Content-Type: application/json”',
    invalid_json: 'El cuerpo de la solicitud no es un JSON válido',
    forbidden: 'No tiene permiso para realizar esta acción.',
    not_found: 'No se ha encontrado el elemento o no tiene acceso a él.',
    edit_conflict: 'Otra persona ha modificado este registro mientras usted lo editaba.',
    organization_not_found: 'No existe ninguna organización con este ID.',
    organization_mismatch: 'Esta dirección pertenece a otra organización.',
    organization_suspended: 'Esta organización está suspendida. Póngase en contacto con el administrador del servidor.',
    organization_unavailable: 'Se está preparando esta organización. Inténtelo de nuevo en unos instantes.',
    nothing_to_deploy: 'Seleccione al menos un componente nuevo o modificado para implementar.',
    http_error: 'Error en la solicitud',
  },
} satisfies Translation['errors'];
