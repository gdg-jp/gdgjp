package img

//go:generate sh -c "pnpm --dir ../../.. --filter @gdgjp/img openapi:bundle && go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen --config oapi-codegen.yaml ../../../img/openapi/dist/openapi.yaml"
