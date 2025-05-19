# message-queue

## architecture

Exchange manages topic creation, deletion and routing

Topics will clean up messages that have been processed after a set time interval.

Topic names that end in `#temp` will be memory only and not persisted to metadata 
or to disk.

New consumers will only get messages that were sent after they were created.

Each consumer is responsible for marking a message as read after it has 
been processed.

Channels with a single consumer will process messages in the order they were sent.

If multiple consumers are using the same channel name, the same message will be 
received multiple times. Order is no longer guaranteed.
