package tinyurl

//go:generate sh -c "pnpm --dir ../../.. --filter @gdgjp/tinyurl openapi:bundle && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config oapi-codegen.yaml ../../../tinyurl/openapi/dist/openapi.yaml"
