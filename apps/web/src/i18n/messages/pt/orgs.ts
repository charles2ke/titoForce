import type { Translation } from '../../index.ts';

export default {
  signIn: {
    organization: 'Organização',
    organizationHelp: 'O ID fornecido pelo seu administrador, como “acme”.',
    to: 'Entrando em {name}',
    notFound: 'A organização “{slug}” não existe.',
    noAccount: 'Primeira vez no titoForce?',
    createOrganization: 'Criar uma organização',
  },

  signUp: {
    title: 'Crie sua organização',
    subtitle: 'Sua organização terá um banco de dados próprio, e você vai administrá-la.',
    organizationName: 'Nome da organização',
    organizationId: 'ID da organização',
    organizationIdHelp: 'Usado para fazer login: letras minúsculas, números e hifens.',
    yourName: 'Seu nome',
    passwordHelp: 'Pelo menos 8 caracteres.',
    demo: 'Adicionar registros de exemplo para você explorar',
    submit: 'Criar organização',
    haveAccount: 'Já tem uma organização?',
    signIn: 'Entrar',
    disabled: 'O cadastro não está ativado neste servidor. Peça uma conta ao administrador do servidor.',
  },

  switcher: {
    title: 'Trocar de organização',
    help: 'Cada organização tem os próprios usuários e dados, por isso você faz login em cada uma separadamente.',
    organizationId: 'ID da organização',
    recent: 'Recentes',
    current: 'Atual',
    open: 'Abrir',
  },

  sandbox: {
    badge: 'Sandbox',
    banner: 'Sandbox {name} de {parent}. As alterações feitas aqui não afetam a produção.',
    openProduction: 'Abrir produção',
  },

  problem: {
    title: 'Esta organização não está disponível',
    tryAgain: 'Tentar novamente',
    otherOrganization: 'Entrar em outra organização',
  },

  native: {
    title: 'Conecte-se ao seu servidor',
    subtitle: 'Informe o endereço do servidor do titoForce da sua organização.',
    server: 'Endereço do servidor',
    serverPlaceholder: 'crm.example.com',
    connect: 'Conectar',
    invalid: 'Insira um endereço da web, como crm.example.com.',
    unreachable: 'Não foi possível acessar um servidor do titoForce em {url}. Verifique o endereço e se o servidor permite este aplicativo.',
    connectedTo: 'Servidor: {url}',
    change: 'Alterar',
  },
} satisfies Translation['orgs'];
