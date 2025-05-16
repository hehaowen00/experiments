use std::array;
use std::ptr;
use std::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};

fn pack(index: usize, tag: usize) -> usize {
    (tag << 32) | index
}

fn unpack(value: usize) -> (usize, usize) {
    let index = value & 0xFFFF_FFFF;
    let tag = value >> 32;
    (index, tag)
}

pub struct LockFreeArray<T: Send + Sync, const N: usize> {
    slots: [AtomicPtr<T>; N],
    freelist_head: AtomicUsize,
    next: [AtomicUsize; N],
}

impl<T: Send + Sync, const N: usize> LockFreeArray<T, N> {
    pub fn new() -> Self {
        let slots = array::from_fn(|_| AtomicPtr::new(ptr::null_mut()));
        let next = array::from_fn(|i| AtomicUsize::new(if i + 1 < N { i + 1 } else { N }));

        Self {
            slots,
            freelist_head: AtomicUsize::new(pack(0, 0)),
            next,
        }
    }

    pub fn try_insert(&self, value: T) -> Result<usize, T> {
        let boxed = Box::into_raw(Box::new(value));
        loop {
            let old = self.freelist_head.load(Ordering::Acquire);
            let (head, tag) = unpack(old);

            if head == N {
                let value = unsafe { *Box::from_raw(boxed) };
                return Err(value);
            }

            let next_index = self.next[head].load(Ordering::Relaxed);
            let new = pack(next_index, tag.wrapping_add(1));

            if self
                .freelist_head
                .compare_exchange(old, new, Ordering::AcqRel, Ordering::Relaxed)
                .is_ok()
            {
                self.slots[head].store(boxed, Ordering::Release);
                return Ok(head);
            }
        }
    }

    pub fn take(&self, index: usize) -> Option<T> {
        if index >= N {
            return None;
        }

        let ptr = self.slots[index].swap(ptr::null_mut(), Ordering::AcqRel);
        if ptr.is_null() {
            return None;
        }

        let value = unsafe { *Box::from_raw(ptr) };

        loop {
            let head = self.freelist_head.load(Ordering::Acquire);
            self.next[index].store(head, Ordering::Relaxed);
            if self
                .freelist_head
                .compare_exchange(head, index, Ordering::AcqRel, Ordering::Relaxed)
                .is_ok()
            {
                break;
            }
        }

        Some(value)
    }
}

const ARRAY_SIZE: usize = 100;
const PRODUCERS: usize = 6;
const CONSUMERS: usize = 2;
const OPS_PER_PRODUCER: usize = 100_000;
const TRIALS: usize = 10;

use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

fn run_lockfree_trial() -> Duration {
    let lfa = LockFreeArray::<usize, ARRAY_SIZE>::new();
    let arr = Arc::new(Box::new(lfa));
    let mut handles = Vec::new();
    let start = Instant::now();

    for _ in 0..PRODUCERS {
        let arr = Arc::clone(&arr);
        handles.push(thread::spawn(move || {
            for i in 0..OPS_PER_PRODUCER {
                while arr.try_insert(i).is_err() {
                    std::hint::spin_loop();
                }
            }
        }))
    }

    for _ in 0..CONSUMERS {
        let arr = Arc::clone(&arr);
        handles.push(thread::spawn(move || loop {
            for i in 0..ARRAY_SIZE {
                let _ = arr.take(i);
            }
        }))
    }

    for handle in handles.into_iter().take(PRODUCERS) {
        handle.join().unwrap();
    }

    Duration::from_secs_f64(start.elapsed().as_secs_f64())
}

fn run_mutex_trial() -> Duration {
    let vec = Arc::new(Mutex::new(vec![None; ARRAY_SIZE]));
    let mut handles = Vec::new();

    let start = Instant::now();

    for _ in 0..PRODUCERS {
        let vec = Arc::clone(&vec);
        handles.push(thread::spawn(move || {
            for i in 0..OPS_PER_PRODUCER {
                loop {
                    let mut guard = vec.lock().unwrap();
                    if let Some(pos) = guard.iter_mut().position(|v| v.is_none()) {
                        guard[pos] = Some(i);
                        break;
                    }
                }
            }
        }));
    }

    for _ in 0..CONSUMERS {
        let vec = Arc::clone(&vec);
        handles.push(thread::spawn(move || loop {
            let mut guard = vec.lock().unwrap();
            for val in guard.iter_mut() {
                let _ = val.take();
            }
        }));
    }

    for handle in handles.into_iter().take(PRODUCERS) {
        handle.join().unwrap();
    }

    Duration::from_secs_f64(start.elapsed().as_secs_f64())
}

fn main() {
    println!("Hello, world!");

    for _ in 0..TRIALS {
        let elapsed = run_lockfree_trial();
        println!("Lockfree: {:?}", elapsed);
    }

    for _ in 0..TRIALS {
        let elapsed = run_mutex_trial();
        println!("Mutex: {:?}", elapsed);
    }
}
