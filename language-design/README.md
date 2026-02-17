# language design

```
-- this is a comment

struct dual
  real f64
  im f64
end

-- operator overloading
func _add(l: dual, r: dual) dual
  return dual(real: l.real + r.real, im: l.im + r.im)
end

-- overloads _add, _sub, _mul, _div, _mod, _and, _or, _not, _band, _bor, _bnot, _bxor
-- _cap, _len, _string
-- #var = len(var)

struct fib
  cache map[i64, i64] -- could also use an array
end

func fib:init()
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

func fib:calc(n: i64) i64
  const r, ok = self.cache[n]
  if ok then
    return r
  else
    const r = self:calc(n-1) + self:calc(n-2)
    self.cache[n] = r
    return r
  end
end

const mem = import("mem")
const thread = import("thread")

func main()
   -- memory allocation strategy
   -- also implement mem.heap(), mem.debug(), mem.fixed(size: u64)
  const alloc, free = mem.arena()

   -- can have a const ref or a mut ref determined if the variable is mut or const on assignment
   -- functions can take a mut ref as a const ref in arguments but cannot make a const ref into a mut ref
  const test: ref dual = alloc(dual(real: 1, im: 9))

  const a = dual(real: 1, im: 5)
  const b = dual(real: 4, im: 7)
  print(a + b)

  mut fibonacci = fib()
  fibonacci:init()

  print(fibonacci:calc(10))

  for i =1,10 do
  end

  -- can be buffered or unbuffered
  -- channel.new(0) means sender waits until receiver finishes
  mut ch1: chan string = channel.new()
  mut ch2: chan i64 = channel.new()

  const handle = thread.spawn(func()
    for i = 1,20 do
      ch1.send(string(i))
      ch2.send(i)
    end

    poll(ch2.send(0), ch1.send(string(0))
  end)
  defer handle.join()

  while true do
    const ready = poll(ch1.recv(), ch2.recv(), timeout(10))

    switch ready do
      case 1 do
        print(ch1:recv())
      end

      default
      end
    end
  end
end
```
