package supervisor

type RestartPolicy int

const (
	RestartAlways RestartPolicy = iota
	RestartLimited
	RestartNever
)
