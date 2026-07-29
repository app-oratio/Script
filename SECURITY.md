# Segurança

## Princípios

- A ferramenta nunca grava diretamente na branch principal.
- Nenhuma operação de exclusão é implementada.
- `force` não é usado.
- O token informado na página não é persistido.
- O token não é enviado aos servidores das imagens.
- Os servidores das imagens recebem somente requisições públicas sem credenciais.
- As chamadas autenticadas são destinadas apenas a `api.github.com`.
- A Content Security Policy restringe conexões aos domínios necessários.
- Caminhos absolutos, `..` e destinos fora de `assets/images/` são recusados.
- Imagens existentes diferentes exigem autorização explícita.
- A publicação é interrompida quando a branch-base mudou depois da análise.

## Token recomendado

Utilize token granular, com prazo de validade curto, limitado ao repositório do Oratio. Revogue-o depois da importação caso ele tenha sido criado apenas para essa tarefa.

Permissões mínimas para a página:

- Contents: Read and write
- Pull requests: Read and write, opcional para abertura automática da PR

O workflow de fallback lê o token do segredo `ORATIO_TOKEN`; o valor não deve ser inserido no YAML nem enviado como input do workflow.

## Limitação de CORS

O modo da página depende de os servidores das imagens permitirem leitura pelo navegador. Quando isso não ocorre, use o workflow de fallback. Não utilize proxies CORS públicos, pois eles acrescentam uma terceira parte ao fluxo e podem alterar ou registrar os arquivos transferidos.
