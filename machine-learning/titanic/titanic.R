train <- read.csv('./datasets/titanic/train.csv')
test <- read.csv('./datasets/titanic/test.csv')
solution <- read.csv('./datasets/titanic/solution.csv')

summary(train$Sex)
prop.table(table(train$Sex, train$Survived))
prop.table(table(train$Sex, train$Survived), 1)

train$Deck <- sapply(strsplit(as.character(train$Cabin), "[^A-Za-z]+"), function(x) x[1])
test$Deck <- sapply(strsplit(as.character(test$Cabin), "[^A-Za-z]+"), function(x) x[1])

fit <- rpart(Survived ~ Pclass + Sex + Age + SibSp + Parch + Fare + Embarked + Deck, data=train, method="class")
plot(fit)
text(fit)
fancyRpartPlot(fit)

prediction <- predict(fit, test, type='class')
submission <- data.frame(PassengerId = test$PassengerId, Survived = prediction)

correct <- sum(solution$Survived == submission$Survived)
print(correct)

accuracy <- mean(solution$Survived == submission$Survived)
print(accuracy)
