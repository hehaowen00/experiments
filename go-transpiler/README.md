# go-transpiler

```go
// if function last value returned is an error
// the function is wrapped in a result
func Test() (string, string, error) {
}

func Test() Result[(string, string)] { 
}

// each field is its own variant
type Result[T any] enum {
  Ok T
  Err error
}

func (r Result[T]) UnwrapPanic() T {
  return T 
}

match (result, result) {
  case Ok(v0), Ok(v1):
    fmt.Println("hello, world!")
    if true {
      break
    }
    // will not reach
  case Err(e0), Ok(v1):
  case Ok(v0), Err(e1):
  case Err(e0), Err(e1):
}

func PropagateError() Result[string] {
  x string := someFunc()? // in line typing with := 
  return Ok(x + "")
}

func main() {
  x mut string := "" // x is a mutable string
  x = x + "!"

  y string := "" // y is an immutable string
  y = y + "!" // fails

  // tuples are first class
  (x mut int32, y int32) := (0, 1)
}
```
