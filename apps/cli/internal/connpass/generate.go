package connpass

//go:generate sh -c "pnpm --dir ../../.. --filter @gdgjp/connpass openapi:bundle && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config oapi-codegen.yaml ../../../connpass/openapi/dist/openapi.yaml"
