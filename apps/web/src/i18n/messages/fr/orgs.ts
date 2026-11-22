import type { Translation } from '../../index.ts';

export default {
  signIn: {
    organization: 'Organisation',
    organizationHelp: 'L’identifiant fourni par votre administrateur, par ex. « acme ».',
    to: 'Connexion à {name}',
    notFound: 'L’organisation « {slug} » n’existe pas.',
    noAccount: 'Vous découvrez titoForce ?',
    createOrganization: 'Créer une organisation',
  },

  signUp: {
    title: 'Créer votre organisation',
    subtitle: 'Votre organisation dispose de sa propre base de données. Vous en assurerez l’administration.',
    organizationName: 'Nom de l’organisation',
    organizationId: 'Identifiant de l’organisation',
    organizationIdHelp: 'Sert à se connecter : lettres minuscules, chiffres et traits d’union.',
    yourName: 'Votre nom',
    passwordHelp: 'Au moins 8 caractères.',
    demo: 'Ajouter des enregistrements d’exemple pour découvrir titoForce',
    submit: 'Créer l’organisation',
    haveAccount: 'Vous avez déjà une organisation ?',
    signIn: 'Se connecter',
    disabled: 'L’inscription n’est pas activée sur ce serveur. Demandez un compte à son administrateur.',
  },

  switcher: {
    title: 'Changer d’organisation',
    help: 'Chaque organisation a ses propres utilisateurs et données : vous vous connectez donc à chacune séparément.',
    organizationId: 'Identifiant de l’organisation',
    recent: 'Récentes',
    current: 'Actuelle',
    open: 'Ouvrir',
  },

  sandbox: {
    badge: 'Sandbox',
    banner: 'Sandbox {name} de l’organisation {parent}. Les modifications effectuées ici n’ont aucun effet sur la production.',
    openProduction: 'Ouvrir la production',
  },

  problem: {
    title: 'Cette organisation n’est pas disponible',
    tryAgain: 'Réessayer',
    otherOrganization: 'Se connecter à une autre organisation',
  },

  native: {
    title: 'Connexion à votre serveur',
    subtitle: 'Saisissez l’adresse du serveur titoForce de votre organisation.',
    server: 'Adresse du serveur',
    serverPlaceholder: 'crm.example.com',
    connect: 'Se connecter',
    invalid: 'Saisissez une adresse web, par ex. crm.example.com.',
    unreachable:
      'Impossible de joindre un serveur titoForce à l’adresse {url}. Vérifiez l’adresse et assurez-vous que le serveur autorise cette application.',
    connectedTo: 'Serveur : {url}',
    change: 'Modifier',
  },
} satisfies Translation['orgs'];
