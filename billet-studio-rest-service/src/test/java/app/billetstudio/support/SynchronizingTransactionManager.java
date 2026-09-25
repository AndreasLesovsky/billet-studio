package app.billetstudio.support;

import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;

/**
 * A transaction manager with no resource behind it: it runs the full synchronization lifecycle (afterCommit only on
 * commit), which is all a unit test of TransactionTemplate code needs.
 */
public class SynchronizingTransactionManager extends AbstractPlatformTransactionManager {

    private int commits;
    private int rollbacks;

    @Override
    protected Object doGetTransaction() {
        return new Object();
    }

    @Override
    protected void doBegin(Object transaction, TransactionDefinition definition) {
    }

    @Override
    protected void doCommit(DefaultTransactionStatus status) {
        commits++;
    }

    @Override
    protected void doRollback(DefaultTransactionStatus status) {
        rollbacks++;
    }

    public int commits() {
        return commits;
    }

    public int rollbacks() {
        return rollbacks;
    }
}
