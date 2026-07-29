# Relatório de validação

## Código da ferramenta

- `app.js` passou por `node --check`.
- A página não carrega scripts externos em tempo de execução.
- A política CSP restringe conexões a `api.github.com` e ao próprio site.
- O código não utiliza `localStorage`, `sessionStorage`, cookies ou serviço de análise.
- O fluxo de atualização usa `force: false`.
- O modo padrão cria branch de revisão.
- O importador não implementa exclusão de arquivos.

## Pacote devocional incluído

- SHA-256 confirmado: `c2e3a1d4c4dfbb25c36d96e64254aebd0626c15433b4b90ab6371d7e1ae16eed`.
- 1.662 entradas de arquivo no ZIP.
- 1.652 arquivos pertencem às coleções devocionais permitidas.
- Os demais arquivos são relatórios técnicos ignorados pela ferramenta.
- Nenhum caminho absoluto ou com `..` foi encontrado.
- Os 1.652 Markdown passaram por verificação externa de UTF-8, front matter YAML, campos essenciais, relacionamento diário e presença de `sections` nos conteúdos contáveis.

## Limite do teste

O ambiente de execução utilizado para empacotar a ferramenta bloqueou navegação de navegador para endereços locais. Por isso, a interface completa não pôde ser exercitada automaticamente em Chromium. O JavaScript foi validado sintaticamente e o pacote foi auditado por uma verificação independente equivalente às regras locais essenciais.
