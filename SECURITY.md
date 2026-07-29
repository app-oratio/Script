# Segurança

## Tratamento do token

O token informado na interface:

- é mantido apenas no valor do campo enquanto a página permanece aberta;
- é usado exclusivamente no cabeçalho `Authorization` das chamadas para `https://api.github.com`;
- não é enviado a qualquer serviço próprio desta página;
- não é registrado no painel técnico;
- é apagado automaticamente depois de uma publicação concluída.

A política CSP do `index.html` impede conexões JavaScript para domínios diferentes do próprio site e da API oficial do GitHub.

## Recomendações

- hospede o importador em um repositório sob seu controle;
- não adicione scripts externos ou ferramentas de análise;
- use um token granular restrito ao repositório Oratio;
- mantenha o modo de branch de revisão;
- revogue o token após o uso;
- não compartilhe capturas de tela enquanto o token estiver visível.

## Limites de confiança

O navegador processa arquivos provenientes do ZIP, mas nomes e conteúdos são inseridos na interface somente por APIs de texto do DOM. O código não renderiza HTML vindo do pacote.
