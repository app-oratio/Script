# Relatório de validação

Data da preparação: 29 de julho de 2026.

## Inventário

- 286 linhas de imagens.
- 286 slugs únicos.
- Todos os slugs seguem o padrão de letras minúsculas, números e hífens.
- Todas as URLs usam HTTPS.
- 285 URLs pertencem a `imcimage.weebly.com`.
- 1 URL pertence a `img.oratioapp.com.br`.
- Todas as URLs possuem extensão `.png` no inventário.
- O inventário embutido no `index.html` é idêntico ao arquivo `data/imagens.csv`.

## Página

- JavaScript validado sintaticamente com `node --check`.
- Nenhuma referência a `localStorage` ou `sessionStorage`.
- Nenhuma atualização forçada de referência Git.
- Nenhuma operação de exclusão.
- Política CSP presente.
- Token apagado do campo depois da tentativa de publicação.
- Criação exclusiva de branch de revisão.
- Comparação de imagens existentes pelo SHA do blob Git.
- Árvores divididas em lotes de 75 entradas.

## Fallback

- Script Python compilado com `py_compile`.
- Workflow YAML analisado estruturalmente.
- Teste unitário local de preservação de PNG.
- Teste unitário local de conversão JPEG para PNG.
- Teste unitário local de mapeamento entre slug, Markdown e destino.
- O workflow somente adiciona alterações dentro de `assets/images`.
- O relatório do workflow é publicado como artefato, não é inserido no Oratio.

## Limitações do ambiente de validação

O teste visual automatizado em Chromium não pôde ser executado porque o navegador do Playwright não estava instalado no ambiente. O HTML, o JavaScript, o Python, o YAML, o inventário e as funções críticas foram validados separadamente.

Os downloads reais das 286 imagens não foram executados neste ambiente, que não possuía acesso direto aos servidores externos. A própria ferramenta realiza a validação completa antes de permitir a publicação. Se o navegador encontrar bloqueio de CORS, deve-se usar o workflow de fallback incluído.
