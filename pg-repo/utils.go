package repo

func SkipUpsert(col string) string {
	return "!" + col
}
