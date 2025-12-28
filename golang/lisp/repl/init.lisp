(def reduce (lambda (f list start) (cond ((empty? list) start) (#t (f (cdr list) (reduce f (car list) start))))))
(def repeat (lambda (acc x y) (cond ((eq? 0 y) acc) (#t (repeat (push acc (eval x)) (x) (- y 1))))))

(def lte? (lambda (x y) (or (eq? x y) (lt? x y))))
(def gte? (lambda (x y) (or (eq? x y) (gt? x y))))

(def randInt (lambda (l u) (round (+ (* (rand) (- u l)) l))))

(def fac (lambda (n) (cond ((eq? n 0) 1) ((eq? n 1) 1) (#t (* n (fac (- n 1)))))))
(def fib (lambda (n) (cond ((eq? n 1) 1) ((eq? n 0) 0) (#t (+ (fib (- n 1)) (fib (- n 2)))))))

; (repeat () '(rand) 10)
