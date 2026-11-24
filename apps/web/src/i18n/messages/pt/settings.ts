import type { Translation } from '../../index.ts';

export default {
  title: 'Minhas configurações',

  profile: {
    title: 'Perfil',
    jobTitle: 'Cargo',
    adminHint: 'Edite nomes, cargos e funções em {link}.',
    usersLink: 'Configuração › Usuários',
    askAdmin: 'Peça a um administrador para alterar seu nome, cargo ou função.',
  },

  password: {
    title: 'Alterar senha',
    current: 'Senha atual',
    new: 'Nova senha',
    help: 'Pelo menos 8 caracteres.',
    confirm: 'Confirme a nova senha',
    mismatch: 'As senhas não coincidem',
    submit: 'Atualizar senha',
    changed: 'Senha alterada. Suas outras sessões foram encerradas.',
  },

  language: {
    title: 'Idioma',
    help: 'O idioma do titoForce em todos os dispositivos em que você faz login. Os rótulos que seus administradores não traduziram continuam em inglês.',
    browserDefault: 'Idioma do navegador ({language})',
  },

  defaultApp: {
    title: 'Aplicativo padrão',
    help: 'Onde você chega depois de fazer login. Trocar de aplicativo pelo seletor de aplicativos também atualiza esta opção (salva neste navegador).',
    changed: '{app} agora é seu aplicativo padrão',
  },

  ai: {
    title: 'Provedor de IA',
    connected: 'Conectado',
    offline: 'Modo offline',
    openai: 'Compatível com OpenAI',
    rulesEngine: 'Mecanismo de regras integrado',
    configuredBy: 'O provedor é configurado por um administrador por meio de variáveis de ambiente do servidor.',
  },

  access: {
    title: 'Seu acesso',
    capabilities: {
      setup: 'Administrar a configuração',
      manageAutomations: 'Gerenciar automações, relatórios e painéis',
      manageAgents: 'Gerenciar agentes de IA',
      viewSensitive: 'Ver campos confidenciais',
    },
    read: 'Ler',
    create: 'Criar',
    edit: 'Editar',
    delete: 'Excluir',
    all: 'Todos',
    own: 'Próprios',
    footnote: '“{own}” significa os registros dos quais você é proprietário. Os objetos que você não pode ler ficam ocultos.',
  },
} satisfies Translation['settings'];
