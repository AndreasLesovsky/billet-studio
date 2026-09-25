package app.billetstudio.support;

import java.util.List;

import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Transaction synchronization on the current thread without a database, so a unit test can tell WHEN work deferred
 * through AfterCommit runs: not before {@link #commit()}, and never after {@link #rollback()}.
 */
public final class SimulatedTransaction implements AutoCloseable {

    private SimulatedTransaction() {
        TransactionSynchronizationManager.initSynchronization();
    }

    public static SimulatedTransaction begin() {
        return new SimulatedTransaction();
    }

    public void commit() {
        List<TransactionSynchronization> synchronizations = TransactionSynchronizationManager.getSynchronizations();
        close();
        synchronizations.forEach(TransactionSynchronization::afterCommit);
    }

    public void rollback() {
        close();
    }

    @Override
    public void close() {
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }
}
