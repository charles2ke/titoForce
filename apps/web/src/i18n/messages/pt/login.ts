import type { Translation } from '../../index.ts';

export default {
  tagline: 'O CRM agêntico para toda a sua empresa.',
  intro: 'Uma plataforma orientada por metadados para clientes, trabalho e pessoas, com agentes de IA integrados.',
  highlights: {
    sales: 'Vendas: leads, contas, pipeline, cotações e previsões',
    service: 'Atendimento: casos, conhecimento e SLAs',
    work: 'Trabalho: projetos, quadros, calendários e linhas do tempo',
    people: 'Pessoas: funcionários, folgas, avaliações e contratações',
    ai: 'Agentes de IA que agem com as mesmas permissões que você',
  },
  license: 'Código aberto · AGPL-3.0',

  title: 'Entrar',
  subtitle: 'Que bom ter você de volta. Informe seu email corporativo e sua senha.',
  submit: 'Entrar',

  demo: {
    signInAs: 'Empresa de demonstração: entrar como',
    password: 'Senha de demonstração: {password}',
  },
} satisfies Translation['login'];
