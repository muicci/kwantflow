export type AppShellHref =
	| '/'
	| '/companies'
	| '/materials'
	| '/labour-rates'
	| '/equipment-rates'
	| '/subcontract-rates'
	| '/cost-presets'
	| '/estimate-templates'
	| '/classification-systems'
	| `/classification-systems/${string}`
	| `/preview/file/${string}`
	| `/project/${string}`
	| `/project/${string}/asset/${string}`
	| `/project/${string}/wbs`
	| `/project/${string}/quote`
	| `/project/${string}/quote/pdf`;
