package accounts

//go:generate sh -c "pnpm --dir ../../.. --filter @gdgjp/accounts openapi:bundle && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config oapi-codegen.yaml ../../../accounts/openapi/dist/openapi.yaml"
