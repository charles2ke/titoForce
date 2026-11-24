import type { Translation } from '../../index.ts';

export default {
  signIn: {
    organization: 'Organización',
    organizationHelp: 'El ID que le ha dado su administrador, p. ej., “acme”.',
    to: 'Va a iniciar sesión en {name}',
    notFound: 'No existe ninguna organización con el ID “{slug}”.',
    noAccount: '¿Primera vez en titoForce?',
    createOrganization: 'Crear una organización',
  },

  signUp: {
    title: 'Crear su organización',
    subtitle: 'Su organización tendrá su propia base de datos. Usted será quien la administre.',
    organizationName: 'Nombre de la organización',
    organizationId: 'ID de la organización',
    organizationIdHelp: 'Se usa para iniciar sesión: letras minúsculas, números y guiones.',
    yourName: 'Su nombre',
    passwordHelp: 'Al menos 8 caracteres.',
    demo: 'Añadir registros de ejemplo para explorar',
    submit: 'Crear organización',
    haveAccount: '¿Ya tiene una organización?',
    signIn: 'Iniciar sesión',
    disabled: 'El registro no está habilitado en este servidor. Pida una cuenta al administrador del servidor.',
  },

  switcher: {
    title: 'Cambiar de organización',
    help: 'Cada organización tiene sus propios usuarios y datos, por lo que debe iniciar sesión en cada una por separado.',
    organizationId: 'ID de la organización',
    recent: 'Recientes',
    current: 'Actual',
    open: 'Abrir',
  },

  sandbox: {
    badge: 'Sandbox',
    banner: 'Sandbox {name} de {parent}. Los cambios que se hagan aquí no afectan a producción.',
    openProduction: 'Abrir producción',
  },

  problem: {
    title: 'Esta organización no está disponible',
    tryAgain: 'Volver a intentarlo',
    otherOrganization: 'Iniciar sesión en otra organización',
  },

  native: {
    title: 'Conectarse a su servidor',
    subtitle: 'Introduzca la dirección del servidor de titoForce de su organización.',
    server: 'Dirección del servidor',
    serverPlaceholder: 'crm.example.com',
    connect: 'Conectar',
    invalid: 'Introduzca una dirección web, p. ej., crm.example.com.',
    unreachable:
      'No se ha podido conectar con un servidor de titoForce en {url}. Compruebe la dirección y que el servidor permita el acceso desde esta aplicación.',
    connectedTo: 'Servidor: {url}',
    change: 'Cambiar',
  },
} satisfies Translation['orgs'];
