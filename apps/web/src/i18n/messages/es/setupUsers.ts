import type { Translation } from '../../index.ts';

export default {
  title: 'Usuarios',
  subtitle: 'Personas que pueden iniciar sesión, con sus roles y accesos.',
  newUser: 'Nuevo usuario',
  searchLabel: 'Buscar usuarios',
  searchPlaceholder: 'Buscar por nombre, correo electrónico, cargo o rol…',
  showInactive: 'Mostrar inactivos ({count})',
  noMatches: 'Ningún usuario coincide con la búsqueda',
  empty: 'No hay usuarios',
  jobTitle: 'Cargo',
  you: 'Usted',
  aiAgent: 'Agente de IA',
  editUser: 'Editar {name}',

  form: {
    newTitle: 'Nuevo usuario',
    create: 'Crear usuario',
    save: 'Guardar usuario',
    added: 'Se ha añadido a {name}',
    saved: 'Se han guardado los cambios de {name}',
    chooseRole: 'Elegir un rol…',
    invalidEmail: 'Introduzca una dirección de correo electrónico válida.',
    passwordTooShort: 'Al menos 8 caracteres.',
    agentNotice:
      'Este es el usuario de servicio de los agentes de IA. Los agentes que inician las automatizaciones actúan como este usuario, por lo que su rol limita lo que pueden hacer. No puede iniciar sesión.',
    emailHelp: 'Se usa para iniciar sesión.',
    fullName: 'Nombre completo',
    titlePlaceholder: 'Ejecutivo de cuentas',
    roleHelp: 'Controla lo que el usuario puede ver y hacer.',
    ownRoleHelp: 'No puede cambiar su propio rol.',
    newPassword: 'Nueva contraseña',
    passwordHelp: 'Al menos 8 caracteres. Compártala con el usuario de forma segura.',
    ownPasswordHelp:
      'Déjelo en blanco para mantener la contraseña actual. Si la cambia, se cerrarán todas sus sesiones.',
    userPasswordHelp:
      'Déjelo en blanco para mantener la contraseña actual. Si la cambia, se cerrará la sesión del usuario.',
    cantDeactivateSelf: 'No puede desactivarse a sí mismo.',
    inactiveHelp: 'Los usuarios inactivos no pueden iniciar sesión. Sus registros se conservan.',
  },
} satisfies Translation['setupUsers'];
