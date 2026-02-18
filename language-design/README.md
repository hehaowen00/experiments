# language design

## Style Guide

- camelCase
- names should be readable or distinguishable even if everything was lower case
- one expression per line

## Language Spec

- statically typed
- pointers and references cannot be null
- maybe monad `some x` and `none`
- interfaces using structs and method pointers
- basic generics
- operator overloading
- all struct fields must be filled out by the user
- structs can be constructed using `name(args)` or `name { field = value }`
- everything is public

## Base Types

```
string
i8, i16, i32, i64
u8, u16, u32, u64
size = alias of u64

array [] -- len = cap
```

## Operators

```
-- overloads _add, _sub, _mul, _exp_, _div, _mod, 
-- _and, _or, _not, _neq, _eq, _lt, _lte, _gt, _gte
-- _band_, _bor_, _bnot_, _bxor_
-- _cap_, _len, _string_, _index_, _range_

-- cap(x)
-- len(x)

-- operators +, -, *, **, /, %, and, or, not, &, |, !
-- not equal ~=, equal ==
```

## Implemented Types

```
hashtable : type K : type V
list : type V
```

## Declaration

prefer immutable variables by default
```
val x = 10
mut y = 3
```

take immutable reference to v
```
val v = 10
val vr = ref v
```

take mutable reference to w
```
mut w = 11
mut wr = mut ref w
```

support look ahead and look backward type inference
```
val s = "" -- makes s a string
val b i32 = 0 -- makes zero i32
```

## Examples

function call syntax
```
func()

variable:method()

struct.function()
struct.method()

struct[type].function()
struct[type].method()

-- anonymous functions
val f = func()
end

f()
```

maybe
```
maybe i32 = none
maybe i32 = 3

-- none is not a valid value for ref
val a ref i32 = none

val a maybe ref i32 = none
```

references
```
alloc(expr)
val a ref i32 = alloc(0)

val a = 1
val aref = ref a
```

- methods imply a reference to self
- `mut self` implies that self must be mutable

enum / variant
```
-- c enum
enum name : repr
  label = value
end

-- variant
enum name
  label()
end
```

expressions
```
val a = if b > 7 then "A" else "B" end
```

example
```
-- this is a comment

-- aliasing
type a = i32

struct dual
  real f64
  im f64
end

struct composite
  lookup ref tree : string
end

struct table : type K : type V
  hash func(key K) u64

  func get(self, key ref K) maybe V
    return none
  end

  func insert(mut self, key K, value V) maybe V
    return none
  end

  func remove(mut self, key ref K) maybe error
    return none
  end
end

struct tree : type T
  root maybe ref treeNode : T
  compare func(a T, b T) bool

  func new(compare func(a T, b T) bool) tree : type T
    return tree : type T {
      root: none,
      compare: compare,
    }
  end

  func insert(mut self, value T)
    -- todo
  end
end

struct treeNode : type T
  children []ref treeNode T
end

mut btree : tree string = tree : string {
  root = none,
  compare = func(a string, b string) bool
    return a < b
  end,
}

mut btree = tree : type string {
  root = none,
  compare = func(a string, b string) bool
    return a < b
  end,
}

enum state
  pending
  ready
  finished
  cancelled 
end

enum node
  str(string)
  float(f64)
  table(map[string, maybe ref node])
  list([]ref node)
end

struct chan
end

struct handle
end

func poll(handles []handle) u64
  return 0
end

struct listnode 
  next maybe ref self
end

-- operator overloading
func _add(l dual, r dual) dual
  return dual{
    real = l.real + r.real, 
    im = l.im + r.im,
  }
end

func err(msg string) error
  return error(msg)
end

struct fib
  cache hashmap[i64, i64] -- could also use an array

  func init()
    self.cache = {
      0: 0,
      1: 1,
      2: 1,
      3: 2,
      4: 3
      5: 5
      6: 8,
    }
  end

  func calc(mut self, n: i64) i64
    val r, ok = self.cache[n]
    if ok then
      return r
    else
      val r = self:calc(n-1) + self:calc(n-2)
      self.cache[n] = r
      return r
    end
  end
end

val mem = import("mem")
val thread = import("thread")
val rand = import("random")
val crypto = import("crypto")
val http = import("http")
val websocket = import("websocket")
val sqlite = import("sqlite")

-- lang unit test
test do
  func dualadd()
  end
end

-- benchmarking
bench do
end

func writeLog(path string, contents []u8) maybe fileError
  val now = time.now()
  val ts = now.format("yyy-mm-dd")

  val f, err = io.openFile("./" + ts + ".json", "w")
  if err ~= none then
    return err
  end
  defer f.close()

  val err = io.writeFile(f, contents)

  -- defer will run here

  return err
end

func sizeof[type T](n u64) u64
  return mem:sizeof[T]() * n
end

func main() 
  -- mut tree: Tree string = Tree {
  --   compare func(a: string, b: string) bool
  --     return a < b
  --   end,
  -- }

  mut tree = tree[string].new(string.compare)

  tree.insert(value string)

   -- memory allocation strategy
   -- also implement mem.heap(), mem.debug(), mem.fixed(size: u64)
  val alloc, free = mem.arena()

  -- defer is block scoped
  defer free()

  -- unlike mem allocators, pool free will return ownership of the object to the pool
  val alloc, free = pool.alloc[i64]()

  val size = mem.sizeof[i64]()

  -- ref = immutable reference
  -- mut ref = mutable reference
  -- functions can take a mut ref as an immutable ref in arguments but 
  -- cannot make an immutable ref into a mut ref
  -- must return non null ref 
  val test = alloc(dual(real: 1, im: 9))

  val a = dual{
    real: 1,
    im: 5,
  }

  val b = dual{4, 7}
  print(a + b)

  mut fibonacci = fib(cache: hashmap[i64, i64].new())
  -- fibonacci:init()

  print(fibonacci:calc(10))

  for i =1,10 do
  end

  val n = node:float(3.14159)

  switch n do
    case node:float(v) do
      print(v)
    end
  end

  val v = 1
  val vref = ref v

  mut maybeStr : maybe string = none
  print(test) -- none

  if maybeStr ~= none then
    print(deref maybeStr) -- unreachable
    maybeStr = some (deref maybeStr + "hello world")
  end

  -- can be buffered or unbuffered
  -- channel.new(0) means sender waits until receiver finishes
  mut ch1: channel[string] = channel[string].init()
  mut ch2: channel[i64] = channel[i64].init()

  -- mut tx, mut rx : sender, receiver = channel.new()

  val handle = thread.spawn(func()
    defer tx1.close()
    defer tx2.close()

    for i = 1,20 do
      -- blocking send
      tx1.send(string(i))
      tx2.send(i)
    end

    -- try_send is a poll handle, only one of these will send
    val h1 = ch2.try_send(0)
    val h2 = ch1.try_send(string(0)
    poll(h1, h2)
  end)
  defer handle.join()

  val handle = rx1.wait()

  while true do
    val timeout = timeout(10)
    val handles = { handle, rx2.wait(), timeout }

    -- poll returns the index of the event that executed
    -- if channel is closed, wait is a no op
    -- if all handles are closed, poll will return -1
    val ready = poll(handles)

    switch ready do
      case rx1 do
        val value, ok = ch1.recv()

        if ok then
          print(value)
        end
      end

      case rx2 do
        ch2.recv()
      end

      case timeout do
        return
      end

      case _ do
      end
    end
  end
end
```
