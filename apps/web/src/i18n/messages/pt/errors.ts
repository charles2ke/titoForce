import type { Translation } from '../../index.ts';

export default {
  network: 'Não foi possível conectar ao servidor do titoForce. Verifique sua conexão e tente novamente.',
  api: {
    unauthenticated: 'Faça login',
    invalid_credentials: 'Email ou senha inválidos',
    rate_limited: 'Muitas solicitações. Aguarde um momento e tente novamente.',
    invalid_password: 'Sua senha atual está incorreta',
    unsupported_media_type: 'Envie as solicitações com “Content-Type: application/json”',
    invalid_json: 'O corpo da solicitação não é um JSON válido',
    forbidden: 'Você não tem permissão para fazer isso.',
    not_found: 'O item não foi encontrado ou você não tem acesso a ele.',
    edit_conflict: 'Outra pessoa alterou este registro enquanto você o editava.',
    organization_not_found: 'Não existe uma organização com este ID.',
    organization_mismatch: 'Este endereço pertence a outra organização.',
    organization_suspended: 'Esta organização está suspensa. Entre em contato com o administrador do servidor.',
    organization_unavailable: 'Esta organização está sendo preparada. Tente novamente em instantes.',
    nothing_to_deploy: 'Selecione pelo menos um componente novo ou alterado para implantar.',
    http_error: 'Falha na solicitação',
  },
} satisfies Translation['errors'];
