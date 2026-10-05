package sns

//go:generate sh -c "pnpm --dir ../../.. --filter @gdgjp/sns openapi:bundle && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config oapi-codegen.yaml ../../../sns/openapi/dist/openapi.yaml"
